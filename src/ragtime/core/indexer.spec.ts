/// <reference types="jest" />
import { ArrayTextIterable } from './iterables';
import { GenericIndexer, defaultPayload } from './indexer';
import { MemoryVectorStore } from './memory.vector-store';
import { DataStore, MemTextItem, TextItem, TextSource } from './model';
import { ParagraphSplitter } from './splitter';
import { KeywordEmbedder } from './test-doubles';

const item = (url: string, text: string, fields: { id?: string; language?: string } = {}) =>
  new MemTextItem('test', url, text, { kind: 'test' }, fields);

const source = <T extends TextItem>(items: T[]): TextSource<T> => ({
  id: 'test', name: 'test', getItems: () => new ArrayTextIterable(items), getItemById: async () => null,
});

class RecordingDataStore implements DataStore {
  readonly saved: string[] = [];
  async save(it: TextItem) { this.saved.push(it.id); }
  async saveBatch(items: TextItem[]) { items.forEach((it) => this.saved.push(it.id)); }
  async findById() { return null; }
  async findByIds() { return []; }
  async delete() { /* not needed */ }
}

describe('GenericIndexer', () => {
  it('embeds every new item once, as passages, and stores the default payload', async () => {
    const embedder = new KeywordEmbedder();
    const store = new MemoryVectorStore();
    const a = item('https://x.test/a', 'alpha text', { id: 'a', language: 'fr' });
    const stats = await new GenericIndexer(embedder, store).indexSource(source([a, a, item('https://x.test/b', 'beta', { id: 'b' })]), 'c');

    expect(stats).toMatchObject({ processedItems: 2, generatedVectors: 2, reusedVectors: 0, skippedItems: 0 });
    expect(embedder.calls.every((call) => call.purpose === 'passage')).toBe(true);
    expect(store.get('c', 'a')!.payload).toEqual(defaultPayload(a));
    expect(store.get('c', 'a')!.payload).toMatchObject({ source_id: 'test', url: 'https://x.test/a', language: 'fr', kind: 'test' });
    expect(store.get('c', 'a')!.vector).toEqual(embedder.vectorOf('alpha text'));
  });

  it('reuses stored vectors: unchanged items cost nothing, moved ones are repointed without re-embedding', async () => {
    const embedder = new KeywordEmbedder();
    const store = new MemoryVectorStore();
    const indexer = new GenericIndexer(embedder, store);
    await indexer.indexSource(source([item('https://x.test/a', 'same text', { id: 'a' }), item('https://x.test/b', 'b text', { id: 'b' })]), 'c');
    const firstVector = store.get('c', 'a')!.vector;

    const stats = await indexer.indexSource(source([
      item('https://x.test/moved/a', 'same text', { id: 'a' }), // moved, same text
      item('https://x.test/b', 'b text', { id: 'b' }), // untouched
      item('https://x.test/c', 'new text', { id: 'c' }), // new
    ]), 'c');

    expect(stats).toMatchObject({ processedItems: 3, generatedVectors: 1, reusedVectors: 1, repointedVectors: 1 });
    expect(embedder.embeddedTexts()).toEqual(['same text', 'b text', 'new text']);
    expect(store.get('c', 'a')).toEqual({ vector: firstVector, payload: expect.objectContaining({ url: 'https://x.test/moved/a' }) });
  });

  it('with reuse off, re-embeds everything', async () => {
    const embedder = new KeywordEmbedder();
    const indexer = new GenericIndexer(embedder, new MemoryVectorStore());
    await indexer.indexSource(source([item('u:a', 'a', { id: 'a' })]), 'c');
    await indexer.indexSource(source([item('u:a', 'a', { id: 'a' })]), 'c', { reuse: false });
    expect(embedder.embeddedTexts()).toEqual(['a', 'a']);
  });

  it('skips unusable text and unsupported or unknown languages, truncates long text', async () => {
    const embedder = new KeywordEmbedder(64, ['en'], 10);
    const store = new MemoryVectorStore();
    const stats = await new GenericIndexer(embedder, store).indexSource(source([
      item('u:1', 'english words that go on and on', { id: '1', language: 'en' }),
      item('u:2', 'mots français', { id: '2', language: 'fr' }),
      item('u:3', 'unknown language', { id: '3' }),
      item('u:4', 'tiny', { id: '4', language: 'en' }),
    ]), 'c', { prepareText: (text) => (text.length > 5 ? text : null) });

    expect(stats).toMatchObject({ processedItems: 1, skippedItems: 3 });
    expect(embedder.embeddedTexts()).toEqual(['english wo']);
  });

  it("calls the embedder in batches of at most its maxBatchSize", async () => {
    const embedder = new KeywordEmbedder(64, 'all', 1000, 2);
    const items = Array.from({ length: 5 }, (_, i) => item(`u:${i}`, `text ${i}`, { id: String(i) }));
    await new GenericIndexer(embedder, new MemoryVectorStore()).indexSource(source(items), 'c', { batchSize: 5 });
    expect(embedder.calls.map((call) => call.texts.length)).toEqual([2, 2, 1]);
  });

  it('splits items into passages when given a splitter', async () => {
    const store = new MemoryVectorStore();
    const long = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${'word '.repeat(10)}`).join('\n\n');
    const stats = await new GenericIndexer(new KeywordEmbedder(), store)
      .indexSource(source([item('https://x.test/page', long, { id: 'page' })]), 'c', { splitter: new ParagraphSplitter({ maxChars: 120, overlapChars: 0 }) });
    expect(stats.generatedVectors).toBeGreaterThan(1);
    expect(await store.count('c', { parent_id: 'page' })).toBe(stats.generatedVectors);
  });

  it('reports each embedder call, runs the after-batch job, stops when asked, and fills the data store', async () => {
    const dataStore = new RecordingDataStore();
    const embedded: number[] = [];
    let afterBatch = 0;
    const items = Array.from({ length: 6 }, (_, i) => item(`u:${i}`, `text ${i}`, { id: String(i) }));
    const stats = await new GenericIndexer(new KeywordEmbedder(), new MemoryVectorStore(), dataStore).indexSource(source(items), 'c', {
      batchSize: 2,
      onEmbedded: async (batch) => { embedded.push(batch.items); expect(batch.dimension).toBe(64); },
      afterBatch: async () => { afterBatch++; },
      shouldStop: () => afterBatch === 2,
    });
    expect(embedded).toEqual([2, 2]);
    expect(afterBatch).toBe(2);
    expect(stats.processedItems).toBe(4);
    expect(dataStore.saved).toEqual(['0', '1', '2', '3']);
  });
});
