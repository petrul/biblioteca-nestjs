import {
  ContentResolver,
  QueryExpander,
  Reranker,
  Retriever,
  Searcher,
  SearchOptions,
  SearchResult,
  SearchResultItem,
  TextItem,
  VectorQueryResult,
} from './model';

export interface HybridSearcherOptions<T extends TextItem> {
  /** More queries searched besides the question (e.g. HyDE drafts). */
  expander?: QueryExpander;
  /** Picks the best of the pooled candidates; without one, the pool's own order is kept. */
  reranker?: Reranker;
  /** Which resolved items may be results at all; it sees the search options too (e.g. its filter). */
  accept?: (item: T, options: SearchOptions) => boolean;
  /** Candidates asked of each retriever for each query. Default 30. */
  perRetriever?: number;
  /** Candidates pooled, resolved and reranked. Default 60. */
  poolSize?: number;
}

/**
 * Searches with several retrievers (vectors, keywords...) for the question
 * and its expansions, pools their candidates round-robin - the first of
 * each list, then the second of each... - so every kind of evidence reaches
 * the pool, then resolves, filters and reranks the pool. Reranked results
 * come first; the rest of the pool fills up to topK.
 */
export class HybridSearcher<T extends TextItem = TextItem> implements Searcher<T> {
  constructor(
    private readonly retrievers: Retriever[],
    private readonly contentResolver: ContentResolver<T>,
    private readonly options: HybridSearcherOptions<T> = {},
  ) {
    if (retrievers.length === 0) throw new Error('a hybrid searcher needs at least one retriever');
  }

  async search(query: string, collection: string, options: SearchOptions = {}): Promise<SearchResult<T>> {
    const topK = options.topK ?? 5;
    const queries = [query, ...(await this.options.expander?.expand(query, { signal: options.signal }) ?? [])];
    const lists = await Promise.all(queries.flatMap((q) => this.retrievers.map((retriever) =>
      retriever.retrieve(q, collection, {
        topK: this.options.perRetriever ?? 30, filter: options.filter, scoreThreshold: options.scoreThreshold, signal: options.signal,
      }))));
    const pool = interleave(lists, this.options.poolSize ?? 60);
    const items = await this.contentResolver.resolveBatch(pool);
    let candidates: SearchResultItem<T>[] = [];
    pool.forEach((match, idx) => {
      const item = items[idx];
      if (item && (this.options.accept?.(item, options) ?? true)) candidates.push({ item, score: match.score, scoreKind: match.scoreKind });
    });
    if (this.options.reranker && candidates.length > 0) {
      const best = await this.options.reranker.rerank(query, candidates, topK);
      const chosen = new Set(best.map((r) => r.item.id));
      candidates = [...best, ...candidates.filter((r) => !chosen.has(r.item.id))];
    }
    return { query, results: candidates.slice(0, topK) };
  }
}

/** The lists' matches merged round-robin, each id once, at most size of them. */
export function interleave(lists: VectorQueryResult[][], size: number): VectorQueryResult[] {
  const pool: VectorQueryResult[] = [];
  const seen = new Set<string>();
  for (let rank = 0; pool.length < size && lists.some((list) => rank < list.length); rank++) {
    for (const list of lists) {
      const match = list[rank];
      if (match && !seen.has(match.id) && pool.length < size) {
        seen.add(match.id);
        pool.push(match);
      }
    }
  }
  return pool;
}
