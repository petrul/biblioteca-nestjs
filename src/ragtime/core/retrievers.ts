import { Embedder, KeywordIndex, Retriever, RetrieveOptions, VectorQueryResult, VectorStore } from './model';
import { matchesFilter } from './memory.vector-store';
import { passesThreshold } from './searcher';

/** Candidates from a VectorStore: the query embedded as a query. */
export class VectorRetriever implements Retriever {
  constructor(
    private readonly embedder: Embedder,
    private readonly vectorStore: VectorStore,
  ) {}

  async retrieve(query: string, collection: string, options: RetrieveOptions): Promise<VectorQueryResult[]> {
    const vector = await this.embedder.embed(query.slice(0, this.embedder.maxInputChars), 'query');
    options.signal?.throwIfAborted();
    return (await this.vectorStore.query(collection, vector, options.topK, options.filter))
      .filter((match) => passesThreshold(match, options.scoreThreshold));
  }
}

/** A deliberately light stemmer: common inflectional endings off ('apprenticeship' and 'apprenticed' meet). */
export function lightStem(word: string): string {
  for (const suffix of ['ships', 'ship', 'ings', 'ing', 'edly', 'ed', 'ies', 'es', 's', 'ly']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) return word.slice(0, -suffix.length);
  }
  return word;
}

export const ENGLISH_STOPWORDS: ReadonlySet<string> = new Set((
  'the a an of to and in on at for is was were did does do what who whom whose which how many much his her its it he she '
  + 'they them their this that these those with from by as be been being when where why or not into upon than then there '
  + 'have has had will would can could should shall may might must you your yours our we us me my mine i am are'
).split(' '));

export interface MemoryKeywordIndexOptions {
  stem?: (word: string) => string;
  stopwords?: ReadonlySet<string>;
  /** Words shorter than this are ignored. Default 3. */
  minWordLength?: number;
  k1?: number;
  b?: number;
}

interface Doc {
  id: string;
  payload: Record<string, unknown>;
  terms: Map<string, number>;
  length: number;
}

/**
 * BM25 over items held in RAM - for collections of human dimensions (a
 * book, a handful of works), next to their vectors. Scores are similarities
 * (higher is better), comparable only within one query.
 */
export class MemoryKeywordIndex implements KeywordIndex {
  private readonly collections = new Map<string, { docs: Doc[]; df: Map<string, number>; totalLength: number }>();

  constructor(private readonly options: MemoryKeywordIndexOptions = {}) {}

  terms(text: string): string[] {
    const stop = this.options.stopwords ?? ENGLISH_STOPWORDS;
    const stem = this.options.stem ?? lightStem;
    const min = this.options.minWordLength ?? 3;
    const words: string[] = text.toLowerCase().match(/\p{L}+/gu) ?? [];
    return words.filter((w) => w.length >= min && !stop.has(w)).map((w) => stem(w));
  }

  private collection(name: string) {
    let collection = this.collections.get(name);
    if (!collection) this.collections.set(name, (collection = { docs: [], df: new Map(), totalLength: 0 }));
    return collection;
  }

  async add(name: string, items: { id: string; text: string; payload: Record<string, unknown> }[]): Promise<void> {
    const collection = this.collection(name);
    for (const item of items) {
      const words = this.terms(item.text);
      const terms = new Map<string, number>();
      for (const word of words) terms.set(word, (terms.get(word) ?? 0) + 1);
      for (const term of terms.keys()) collection.df.set(term, (collection.df.get(term) ?? 0) + 1);
      collection.docs.push({ id: item.id, payload: item.payload, terms, length: words.length });
      collection.totalLength += words.length;
    }
  }

  async count(name: string): Promise<number> {
    return this.collections.get(name)?.docs.length ?? 0;
  }

  /** Forgets a collection (to bound memory). */
  drop(name: string): void {
    this.collections.delete(name);
  }

  async retrieve(query: string, name: string, options: RetrieveOptions): Promise<VectorQueryResult[]> {
    const collection = this.collections.get(name);
    if (!collection || collection.docs.length === 0) return [];
    const k1 = this.options.k1 ?? 1.2;
    const b = this.options.b ?? 0.75;
    const n = collection.docs.length;
    const average = collection.totalLength / n || 1;
    const queryTerms = [...new Set(this.terms(query))];
    const scored: VectorQueryResult[] = [];
    for (const doc of collection.docs) {
      if (!matchesFilter(doc.payload, options.filter)) continue;
      let score = 0;
      for (const term of queryTerms) {
        const tf = doc.terms.get(term);
        if (!tf) continue;
        const df = collection.df.get(term)!;
        score += Math.log(1 + (n - df + 0.5) / (df + 0.5)) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / average));
      }
      if (score > 0) scored.push({ id: doc.id, score, scoreKind: 'similarity', payload: doc.payload });
    }
    return scored.sort((a, c) => c.score - a.score).slice(0, options.topK);
  }
}
