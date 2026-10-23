/// <reference types="jest" />
import { HybridSearcher, interleave } from './hybrid';
import { HypotheticalAnswerExpander, LlmReranker } from './llm-retrieval';
import { MemoryVectorStore } from './memory.vector-store';
import { ContentResolver, MemTextItem, Retriever, SearchResultItem, TextItem, VectorQueryResult } from './model';
import { MemoryKeywordIndex, VectorRetriever, lightStem } from './retrievers';
import { KeywordEmbedder, ScriptedChatModel } from './test-doubles';

const TEXTS = {
  ball: 'Old Fezziwig laid down his pen and the warehouse was cleared for the ball.',
  chain: 'The chain he drew was long, and wound about him like a tail; it was made of cash-boxes.',
  turkey: 'Do you know whether they have sold the prize turkey that was hanging up there?',
  spirits: 'You will be haunted by Three Spirits. Expect the first to-morrow.',
};
const items = new Map<string, TextItem>(Object.entries(TEXTS).map(([id, text]) => [id, new MemTextItem('book', `https://lib.test/carol/${id}`, text, {}, { id })]));
const match = (id: string, score = 1): VectorQueryResult => ({ id, score, scoreKind: 'similarity', payload: { work: 'carol' } });
const resolver: ContentResolver<TextItem> = {
  resolve: async (m) => items.get(m.id) ?? null,
  resolveBatch: async (ms) => ms.map((m) => items.get(m.id) ?? null),
};
const fixed = (ids: string[]): Retriever & { queries: string[] } => {
  const queries: string[] = [];
  return { queries, retrieve: async (q) => { queries.push(q); return ids.map((id) => match(id)); } };
};

describe('MemoryKeywordIndex', () => {
  const index = new MemoryKeywordIndex();
  beforeAll(() => index.add('carol', Object.entries(TEXTS).map(([id, text]) => ({ id, text, payload: { work: 'carol' } }))));

  it('ranks by BM25, stemming inflections and ignoring stopwords', async () => {
    expect(lightStem('apprenticeship')).toBe('apprentice');
    expect(lightStem('turkeys')).toBe('turkey');
    const hits = await index.retrieve('Which turkeys were sold?', 'carol', { topK: 3 });
    expect(hits.map((h) => h.id)).toEqual(['turkey']);
    expect(hits[0]).toMatchObject({ scoreKind: 'similarity', payload: { work: 'carol' } });
    expect(await index.retrieve('the of and', 'carol', { topK: 3 })).toEqual([]);
  });

  it('filters by payload, counts, and forgets a dropped collection', async () => {
    expect(await index.retrieve('ball', 'carol', { topK: 3, filter: { work: 'other' } })).toEqual([]);
    expect(await index.count('carol')).toBe(4);
    const other = new MemoryKeywordIndex();
    await other.add('x', [{ id: '1', text: 'ball', payload: {} }]);
    other.drop('x');
    expect(await other.count('x')).toBe(0);
  });
});

describe('interleave', () => {
  it('takes the first of every list, then the second..., each id once, up to the size', () => {
    const pool = interleave([[match('a'), match('b'), match('c')], [match('b'), match('d')], [match('e')]], 4);
    expect(pool.map((m) => m.id)).toEqual(['a', 'b', 'e', 'd']);
  });
});

describe('HybridSearcher', () => {
  it('searches every retriever with the question and its expansions, pooling all their candidates', async () => {
    const vector = fixed(['chain']);
    const keyword = fixed(['ball']);
    const searcher = new HybridSearcher([vector, keyword], resolver, { expander: { expand: async (q) => [`draft for ${q}`] } });
    const { results } = await searcher.search('whose ball?', 'c', { topK: 5 });
    expect(vector.queries).toEqual(['whose ball?', 'draft for whose ball?']);
    expect(keyword.queries).toEqual(vector.queries);
    expect(results.map((r) => r.item.id)).toEqual(['chain', 'ball']);
  });

  it('puts the reranked results first and fills topK with the rest of the pool', async () => {
    const reranker = { rerank: async <T extends TextItem>(_q: string, r: SearchResultItem<T>[]) => r.filter((x) => x.item.id === 'turkey') };
    const searcher = new HybridSearcher([fixed(['ball', 'chain', 'turkey', 'spirits'])], resolver, { reranker });
    const { results } = await searcher.search('q', 'c', { topK: 3 });
    expect(results.map((r) => r.item.id)).toEqual(['turkey', 'ball', 'chain']);
  });

  it('drops what it does not accept, telling accept the search options', async () => {
    const seen: unknown[] = [];
    const searcher = new HybridSearcher([fixed(['ball', 'chain'])], resolver, {
      accept: (item, options) => { seen.push(options.filter); return item.id !== 'ball'; },
    });
    const { results } = await searcher.search('q', 'c', { topK: 5, filter: { work: 'carol' } });
    expect(results.map((r) => r.item.id)).toEqual(['chain']);
    expect(seen).toEqual([{ work: 'carol' }, { work: 'carol' }]);
  });

  it('works over a real vector store and keyword index together', async () => {
    const embedder = new KeywordEmbedder(128);
    const store = new MemoryVectorStore();
    await store.upsert('c', await Promise.all([...items.values()].map(async (it) => ({ id: it.id, vector: embedder.vectorOf(await it.getText()), payload: { work: 'carol' } }))));
    const index = new MemoryKeywordIndex();
    await index.add('c', Object.entries(TEXTS).map(([id, text]) => ({ id, text, payload: { work: 'carol' } })));
    const { results } = await new HybridSearcher([new VectorRetriever(embedder, store), index], resolver).search('Fezziwig warehouse', 'c', { topK: 1 });
    expect(results[0].item.id).toBe('ball');
  });
});

describe('HypotheticalAnswerExpander', () => {
  it('drafts one answering passage, deterministically; a failure expands to nothing', async () => {
    const model = new ScriptedChatModel(() => '  Old Fezziwig gave a ball.  ');
    expect(await new HypotheticalAnswerExpander(model).expand('whose ball?')).toEqual(['Old Fezziwig gave a ball.']);
    expect(model.calls[0].options).toMatchObject({ deterministic: true });
    const failing = new ScriptedChatModel(() => { throw new Error('down'); });
    expect(await new HypotheticalAnswerExpander(failing).expand('q')).toEqual([]);
  });
});

describe('LlmReranker', () => {
  const results = () => [...items.values()].map((item) => ({ item, score: 1, scoreKind: 'distance' as const }));

  it('keeps the passages the model names, in its order, within topK', async () => {
    const model = new ScriptedChatModel(() => '{"passages": [3, 1, 3, 9, 2]}');
    const reranked = await new LlmReranker(model).rerank('q', results(), 2);
    expect(reranked.map((r) => r.item.id)).toEqual(['turkey', 'ball']);
    expect(model.calls[0].options).toMatchObject({ json: true, deterministic: true });
    expect(model.calls[0].messages[1].content).toContain('[4] You will be haunted by Three Spirits.');
  });

  it('keeps the original order when the reply cannot be read', async () => {
    const reranked = await new LlmReranker(new ScriptedChatModel(() => 'the third one')).rerank('q', results(), 2);
    expect(reranked.map((r) => r.item.id)).toEqual(['ball', 'chain']);
  });
});
