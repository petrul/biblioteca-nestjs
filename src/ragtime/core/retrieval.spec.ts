/// <reference types="jest" />
import { ArrayTextIterable } from './iterables';
import { GenericIndexer } from './indexer';
import { MemoryVectorStore, matchesFilter } from './memory.vector-store';
import { ContentResolver, DataStore, MemTextItem, Reranker, SearchResultItem, TextItem, VectorQueryResult, VectorStore } from './model';
import { DataStoreContentResolver, GenericSearcher, passesThreshold } from './searcher';
import { KeywordEmbedder } from './test-doubles';

const BOOKS = [
  ['https://lib.test/creanga/amintiri/_1', 'Nica fura cireșe din grădina mătușii Mărioara', 'creanga/amintiri'],
  ['https://lib.test/creanga/amintiri/_2', 'Nica merge la școală la Humulești cu popa Duhu', 'creanga/amintiri'],
  ['https://lib.test/eminescu/luceafarul/_1', 'A fost odată ca-n povești o prea frumoasă fată', 'eminescu/luceafarul'],
] as const;

class MapResolver implements ContentResolver<TextItem> {
  constructor(private readonly items: Map<string, TextItem>) {}
  async resolve(match: VectorQueryResult) { return this.items.get(match.id) ?? null; }
  async resolveBatch(matches: VectorQueryResult[]) { return matches.map((m) => this.items.get(m.id) ?? null); }
}

async function library() {
  const embedder = new KeywordEmbedder(256);
  const store = new MemoryVectorStore();
  const items = BOOKS.map(([url, text, work]) => new MemTextItem('lib', url, text, { work }));
  await new GenericIndexer(embedder, store).indexSource({ id: 'lib', name: 'lib', getItems: () => new ArrayTextIterable(items), getItemById: async () => null }, 'c');
  return { embedder, store, items: new Map<string, TextItem>(items.map((it) => [it.id, it])) };
}

describe('MemoryVectorStore', () => {
  it('matches exact values and any-of lists, all conditions together', () => {
    expect(matchesFilter({ work: 'a', lang: 'fr' }, { work: ['a', 'b'], lang: 'fr' })).toBe(true);
    expect(matchesFilter({ work: 'c', lang: 'fr' }, { work: ['a', 'b'] })).toBe(false);
    expect(matchesFilter({ work: 'a' }, undefined)).toBe(true);
  });

  it('refuses an empty delete filter, deletes by filter otherwise', async () => {
    const store = new MemoryVectorStore();
    await store.upsert('c', [{ id: '1', vector: [0], payload: { work: 'a' } }, { id: '2', vector: [1], payload: { work: 'b' } }]);
    await expect(store.delete('c', {})).rejects.toThrow();
    await store.delete('c', { work: 'a' });
    expect(await store.count('c')).toBe(1);
  });
});

describe('GenericSearcher', () => {
  it('embeds the query as a query and returns the nearest items, best first', async () => {
    const { embedder, store, items } = await library();
    const { results } = await new GenericSearcher(embedder, store, new MapResolver(items)).search('Nica școală Humulești', 'c', { topK: 2 });
    expect(embedder.calls.at(-1)!.purpose).toBe('query');
    expect(results[0].item.url).toBe(BOOKS[1][0]);
    expect(results[0].scoreKind).toBe('distance');
    expect(results[0].score).toBeLessThanOrEqual(results[1].score);
  });

  it('narrows the search with a filter (one work, a set of works)', async () => {
    const { embedder, store, items } = await library();
    const searcher = new GenericSearcher(embedder, store, new MapResolver(items));
    const { results } = await searcher.search('Nica', 'c', { topK: 5, filter: { work: 'eminescu/luceafarul' } });
    expect(results.map((r) => r.item.url)).toEqual([BOOKS[2][0]]);
  });

  it('drops matches whose content is gone and keeps the rest aligned with their scores', async () => {
    const { embedder, store, items } = await library();
    const gone = [...items.values()][1];
    items.delete(gone.id);
    const { results } = await new GenericSearcher(embedder, store, new MapResolver(items)).search('Nica școală', 'c', { topK: 3 });
    expect(results.map((r) => r.item.url)).not.toContain(gone.url);
    for (const result of results) {
      const [match] = (await store.query('c', embedder.vectorOf('Nica școală'), 3)).filter((m) => m.id === result.item.id);
      expect(result.score).toBe(match.score);
    }
  });

  it('applies the score threshold the way the score kind reads', async () => {
    expect(passesThreshold({ score: 0.5, scoreKind: 'distance' }, 0.6)).toBe(true);
    expect(passesThreshold({ score: 0.7, scoreKind: 'distance' }, 0.6)).toBe(false);
    expect(passesThreshold({ score: 0.7, scoreKind: 'similarity' }, 0.6)).toBe(true);
    const { embedder, store, items } = await library();
    const searcher = new GenericSearcher(embedder, store, new MapResolver(items));
    const all = (await searcher.search('Nica școală Humulești', 'c', { topK: 3 })).results;
    const threshold = (all[0].score + all[1].score) / 2;
    const { results } = await searcher.search('Nica școală Humulești', 'c', { topK: 3, scoreThreshold: threshold });
    expect(results.map((r) => r.item.url)).toEqual([all[0].item.url]);
  });

  it('asks the store for more candidates when reranking, and keeps the reranked topK', async () => {
    const { embedder, store, items } = await library();
    const query = jest.spyOn(store, 'query');
    const reverse: Reranker = { rerank: async <T extends TextItem>(_q: string, r: SearchResultItem<T>[], k: number) => [...r].reverse().slice(0, k) };
    const { results } = await new GenericSearcher(embedder, store as VectorStore, new MapResolver(items), { reranker: reverse, candidateFactor: 3 })
      .search('Nica', 'c', { topK: 1 });
    expect(query.mock.calls[0][2]).toBe(3);
    expect(results).toHaveLength(1);
  });
});

describe('GenericSearcher accept', () => {
  it('leaves out items it does not accept, oversampling to still fill topK', async () => {
    const { embedder, store, items } = await library();
    const query = jest.spyOn(store, 'query');
    const searcher = new GenericSearcher(embedder, store, new MapResolver(items), { accept: (item) => !item.url.includes('eminescu') });
    const { results } = await searcher.search('Nica fată povești', 'c', { topK: 2 });
    expect(query.mock.calls[0][2]).toBe(8);
    expect(results.map((r) => r.item.url)).toEqual(expect.arrayContaining([BOOKS[0][0], BOOKS[1][0]]));
  });
});

describe('DataStoreContentResolver', () => {
  it('resolves matches by id from the data store, null where missing', async () => {
    const a = new MemTextItem('s', 'u:a', 'a', {}, { id: 'a' });
    const dataStore: DataStore = {
      save: async () => undefined, saveBatch: async () => undefined, delete: async () => undefined,
      findById: async (id) => (id === 'a' ? a : null),
      findByIds: async (ids) => ids.filter((id) => id === 'a').map(() => a),
    };
    const match = (id: string): VectorQueryResult => ({ id, score: 0, scoreKind: 'distance', payload: {} });
    expect(await new DataStoreContentResolver(dataStore).resolveBatch([match('x'), match('a')])).toEqual([null, a]);
  });
});
