import {
  ContentResolver,
  DataStore,
  Embedder,
  Reranker,
  Searcher,
  SearchOptions,
  SearchResult,
  SearchResultItem,
  TextItem,
  VectorQueryResult,
  VectorStore,
} from './model';

/** Whether a match passes the threshold, read the way its score kind is. */
export function passesThreshold(match: { score: number; scoreKind: 'distance' | 'similarity' }, threshold?: number): boolean {
  if (threshold === undefined) return true;
  return match.scoreKind === 'distance' ? match.score <= threshold : match.score >= threshold;
}

export interface GenericSearcherOptions<T extends TextItem = TextItem> {
  /** Re-orders the candidates; the vector store then returns candidateFactor x topK of them. */
  reranker?: Reranker;
  /**
   * Which resolved items may be results at all - e.g. no very short
   * passages, which embeddings place near everything. The vector store then
   * returns candidateFactor x topK candidates.
   */
  accept?: (item: T, options: SearchOptions) => boolean;
  /** Candidates per result wanted when reranking or filtering with accept. Default 4. */
  candidateFactor?: number;
}

/** Embeds the query, finds the nearest vectors and resolves them to their items. */
export class GenericSearcher<T extends TextItem = TextItem> implements Searcher<T> {
  constructor(
    private readonly embedder: Embedder,
    private readonly vectorStore: VectorStore,
    private readonly contentResolver: ContentResolver<T>,
    private readonly options: GenericSearcherOptions<T> = {},
  ) {}

  async search(query: string, collection: string, options: SearchOptions = {}): Promise<SearchResult<T>> {
    const topK = options.topK ?? 5;
    const oversample = this.options.reranker || this.options.accept;
    const candidates = oversample ? topK * (this.options.candidateFactor ?? 4) : topK;
    const queryVector = await this.embedder.embed(query.slice(0, this.embedder.maxInputChars), 'query');
    options.signal?.throwIfAborted();
    const matches = (await this.vectorStore.query(collection, queryVector, candidates, options.filter))
      .filter((match) => passesThreshold(match, options.scoreThreshold));
    const items = await this.contentResolver.resolveBatch(matches);
    // matches whose content is gone are kept in the store, never shown
    let results: SearchResultItem<T>[] = [];
    matches.forEach((match, idx) => {
      const item = items[idx];
      if (item && (this.options.accept?.(item, options) ?? true)) results.push({ item, score: match.score, scoreKind: match.scoreKind });
    });
    if (this.options.reranker) results = await this.options.reranker.rerank(query, results, topK);
    return { query, results: results.slice(0, topK) };
  }
}

/** Resolves matches from a DataStore holding the indexed items (by id). */
export class DataStoreContentResolver<T extends TextItem = TextItem> implements ContentResolver<T> {
  constructor(private readonly dataStore: DataStore<T>) {}

  async resolve(match: VectorQueryResult): Promise<T | null> {
    return this.dataStore.findById(match.id);
  }

  async resolveBatch(matches: VectorQueryResult[]): Promise<(T | null)[]> {
    const found = new Map((await this.dataStore.findByIds(matches.map((m) => m.id))).map((item) => [item.id, item]));
    return matches.map((match) => found.get(match.id) ?? null);
  }
}
