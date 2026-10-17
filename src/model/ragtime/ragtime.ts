import {
  TextItem,
  TextSource,
  Embedder,
  VectorStore,
  DataStore,
  ContentResolver,
  IndexingStats,
  SearchResult,
  RagResponse,
  Generator,
  VectorRecord
} from './ragtime.model';

export class GenericIndexer {
  constructor(
    private readonly embedder: Embedder,
    private readonly vectorStore: VectorStore,
    private readonly dataStore?: DataStore
  ) {}

  async indexSource<T extends TextItem>(
    source: TextSource<T>,
    collection: string,
    batchSize = 10
  ): Promise<IndexingStats> {
    const startTime = Date.now();
    let processedItems = 0;
    let generatedVectors = 0;

    for await (const batch of source.getItems().getBatches(batchSize)) {
      // Deduplicate batch items by deterministic item.id
      const uniqueMap = new Map<string, T>();
      for (const item of batch) {
        if (!uniqueMap.has(item.id)) {
          uniqueMap.set(item.id, item);
        }
      }
      const uniqueBatch = Array.from(uniqueMap.values());

      const texts = await Promise.all(uniqueBatch.map((item) => item.getText()));
      const embeddings = await this.embedder.embedBatch(texts);

      const vectorRecords: VectorRecord[] = uniqueBatch.map((item, idx) => ({
        id: item.id,
        vector: embeddings[idx],
        payload: {
          sourceId: item.sourceId,
          url: item.url,
          ...item.metadata
        }
      }));

      const tasks: Promise<void>[] = [this.vectorStore.upsert(collection, vectorRecords)];
      if (this.dataStore) {
        tasks.push(this.dataStore.saveBatch(uniqueBatch));
      }

      await Promise.all(tasks);

      processedItems += uniqueBatch.length;
      generatedVectors += embeddings.length;
    }

    return {
      processedItems,
      generatedVectors,
      durationMs: Date.now() - startTime
    };
  }
}

export class GenericSearcher<T extends TextItem = TextItem> {
  constructor(
    private readonly embedder: Embedder,
    private readonly vectorStore: VectorStore,
    private readonly contentResolver: ContentResolver<T>
  ) {}

  async search(query: string, collection: string, topK = 5): Promise<SearchResult<T>> {
    const queryVector = await this.embedder.embed(query);
    const vectorMatches = await this.vectorStore.query(collection, queryVector, topK);

    const ids = vectorMatches.map((m) => m.id);
    const resolvedItems = await this.contentResolver.resolveBatch(ids);

    const results = vectorMatches.map((match, idx) => ({
      item: resolvedItems[idx],
      score: match.score
    }));

    return { query, results };
  }
}

export class RagtimeSystem<T extends TextItem = TextItem> {
  constructor(
    private readonly searcher: GenericSearcher<T>,
    private readonly generator: Generator
  ) {}

  async ask(question: string, collection: string, topK = 4): Promise<RagResponse<T>> {
    const searchResult = await this.searcher.search(question, collection, topK);
    const contextItems = searchResult.results.map((r) => r.item);

    const answer = await this.generator.generate(question, contextItems);

    return {
      question,
      answer,
      citations: contextItems
    };
  }
}