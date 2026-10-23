import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';

/**
 * Ragtime core: the contracts of semantic search, retrieval-augmented
 * generation and chat, plus generic implementations over them (indexer.ts,
 * searcher.ts, rag.ts, chatbot.ts...).
 *
 * The core is meant to be extracted and reused: it imports nothing but
 * itself and node: built-ins (a spec enforces it). Concrete stores, models
 * and sources are adapters (../adapters) or belong to the application.
 *
 *   TextSource --items--> [TextSplitter] --> Indexer --> Embedder + VectorStore (+ DataStore)
 *   question --> Searcher: Embedder, VectorStore, ContentResolver, [Reranker], [ContextExpander]
 *            or HybridSearcher: [QueryExpander] + Retrievers (vector, keyword) + ContentResolver + [Reranker]
 *            --> RagSystem: Searcher + Generator (= ChatModel + PromptBuilder)
 *            --> Chatbot: RagSystem + ConversationStore + [QueryRewriter]
 */

// ---------------------------------------------------------------- content

/**
 * Basic unit of text worth indexing and retrieving, identified by its URL.
 *
 * `id` is the item's identity in the stores. Content-derived ids (a hash of
 * the text) make re-indexing cheap: an unchanged text keeps its id - and so
 * its stored vector - even when its URL moves.
 */
export interface TextItem {
  readonly id: string;
  readonly sourceId: string;
  readonly url: string;
  /** Display title (a page title, a chapter heading), when there is one. */
  readonly title?: string;
  /** ISO 639-1 code of the text's language, when known. */
  readonly language?: string;
  readonly metadata: Record<string, unknown>;
  getContentStream(): Promise<ReadableStream<Uint8Array> | Readable>;
  getText(): Promise<string>;
}

export interface MemTextItemFields {
  id?: string;
  title?: string;
  language?: string;
}

/**
 * In-memory TextItem for finite/buffered data. Without an explicit id, the
 * id is a deterministic hash of url and content.
 */
export class MemTextItem implements TextItem {
  readonly id: string;
  readonly title?: string;
  readonly language?: string;

  constructor(
    readonly sourceId: string,
    readonly url: string,
    readonly text: string,
    readonly metadata: Record<string, unknown> = {},
    fields: MemTextItemFields = {},
  ) {
    this.id = fields.id ?? MemTextItem.computeHash(url, text);
    this.title = fields.title;
    this.language = fields.language;
  }

  static computeHash(url: string, content: string): string {
    return createHash('sha256').update(`${url}::${content}`).digest('hex');
  }

  async getContentStream(): Promise<Readable> {
    return Readable.from([this.text]);
  }

  async getText(): Promise<string> {
    return this.text;
  }
}

/** Async iterable stream of TextItems, also readable in batches. */
export interface TextIterable<T extends TextItem = TextItem> extends AsyncIterable<T> {
  getBatches(batchSize: number): AsyncIterable<T[]>;
}

/** A source of data: a website, an API, a database, a digital library... */
export interface TextSource<T extends TextItem = TextItem> {
  readonly id: string;
  readonly name: string;
  getItems(): TextIterable<T>;
  /** null when the item is gone, or when the source cannot look items up by id. */
  getItemById(id: string): Promise<T | null>;
}

/**
 * Cuts an item into passages small enough to embed and to quote (a web page
 * into paragraphs-sized chunks). Sources whose items are passages already
 * (a library's paragraphs) need none.
 */
export interface TextSplitter {
  split(item: TextItem): Promise<TextItem[]>;
}

// ---------------------------------------------------------------- vectors

export interface VectorRecord {
  /** The TextItem's id. */
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

/** distance: lower is closer (Euclid); similarity: higher is closer (cosine, dot). */
export type ScoreKind = 'distance' | 'similarity';

export interface VectorQueryResult {
  id: string;
  /** The store's own score; results come best first. */
  score: number;
  scoreKind: ScoreKind;
  payload: Record<string, unknown>;
}

/** What a VectorStore holds for an id, without the vector. */
export interface StoredPayload {
  id: string;
  payload: Record<string, unknown>;
}

export type FilterValue = string | number | boolean;

/**
 * Payload conditions, all of which must hold: a value matches exactly, an
 * array matches any of its values. `{ work: ['a/b', 'c/d'], language: 'fr' }`
 * keeps the vectors of two works that are in French. No filter (or an empty
 * one) keeps everything.
 */
export type VectorFilter = Record<string, FilterValue | readonly FilterValue[]>;

/** Vector store abstraction (e.g., QDrant). */
export interface VectorStore {
  upsert(collection: string, records: VectorRecord[]): Promise<void>;
  query(collection: string, vector: number[], topK: number, filter?: VectorFilter): Promise<VectorQueryResult[]>;
  /** The payloads stored for those ids - only the ids that exist. */
  retrieve(collection: string, ids: string[]): Promise<StoredPayload[]>;
  /**
   * Replace stored payloads without touching their vectors (e.g. an item whose
   * URL moved while its text did not). The ids must be stored ones (see retrieve).
   */
  setPayload(collection: string, updates: StoredPayload[]): Promise<void>;
  /** Delete every vector matching the filter; an empty filter is refused. */
  delete(collection: string, filter: VectorFilter): Promise<void>;
  count(collection: string, filter?: VectorFilter): Promise<number>;
}

export type VectorMetric = 'euclid' | 'cosine' | 'dot';

/** What a collection must be for an embedder: store-specific tuning stays in the adapter. */
export interface CollectionSpec {
  dimension: number;
  metric: VectorMetric;
  /** Payload fields filtered on (indexed for exact matches where the store supports it). */
  indexedFields?: readonly string[];
}

/** Creating, checking and dropping collections - kept apart from VectorStore's data operations. */
export interface VectorCollectionManager {
  exists(collection: string): Promise<boolean>;
  /** Creates the collection if missing; leaves an existing one untouched. */
  ensure(collection: string, spec: CollectionSpec): Promise<void>;
  /** Throws when an existing collection cannot hold the spec's vectors (another dimension or metric). */
  assertCompatible(collection: string, spec: CollectionSpec): Promise<void>;
  drop(collection: string): Promise<void>;
}

/** Key-value / document data store abstraction (e.g., Cassandra). */
export interface DataStore<T extends TextItem = TextItem> {
  save(item: T): Promise<void>;
  saveBatch(items: T[]): Promise<void>;
  findById(id: string): Promise<T | null>;
  /** The stored items among those ids, in the order of the ids. */
  findByIds(ids: string[]): Promise<T[]>;
  delete(ids: string[]): Promise<void>;
}

// ---------------------------------------------------------------- models

/**
 * Some models embed queries and passages differently (e5's "query: " and
 * "passage: " prefixes, nomic's "search_query: "); symmetric ones ignore it.
 */
export type EmbeddingPurpose = 'query' | 'passage';

/** Text embedder abstraction (e.g., Ollama bge-m3). */
export interface Embedder {
  readonly modelName: string;
  readonly dimension: number;
  /**
   * ISO 639-1 codes this model produces meaningful vectors for, or 'all' for
   * a genuinely multilingual model. Indexing skips items in other languages,
   * and items of unknown language unless this is 'all'.
   */
  readonly supportedLanguages: readonly string[] | 'all';
  /** The longest text (in characters) one input may be; longer ones are truncated before embedding. */
  readonly maxInputChars: number;
  /** The most texts one embedBatch call takes; the indexer splits larger batches. Unlimited when absent. */
  readonly maxBatchSize?: number;
  embed(text: string, purpose?: EmbeddingPurpose): Promise<number[]>;
  embedBatch(texts: string[], purpose?: EmbeddingPurpose): Promise<number[][]>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** A turn of a conversation: what the user said, or what was answered. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  signal?: AbortSignal;
  /** Ask for a JSON answer, when the model supports it. */
  json?: boolean;
  /** Least random sampling (temperature 0): for helpers whose output should repeat, such as rerankers. */
  deterministic?: boolean;
}

/** A chat LLM: messages in, text out (e.g., Ollama qwen3.5, OpenAI, Claude). */
export interface ChatModel {
  readonly modelName: string;
  complete(messages: ChatMessage[], options?: CompletionOptions): Promise<string>;
  stream(messages: ChatMessage[], options?: CompletionOptions): AsyncIterable<string>;
}

export interface GenerateOptions {
  /** Earlier turns of the conversation, oldest first. */
  history?: ChatTurn[];
  signal?: AbortSignal;
}

/** Answers a prompt from context items, numbered [1], [2]... in order (see rag.ts's PromptedGenerator). */
export interface Generator {
  readonly modelName: string;
  generate(prompt: string, context: TextItem[], options?: GenerateOptions): Promise<string>;
  streamGenerate(prompt: string, context: TextItem[], options?: GenerateOptions): AsyncIterable<string>;
}

/** How a question, its context and the conversation become the messages a ChatModel gets. */
export interface PromptBuilder {
  build(question: string, context: TextItem[], history?: ChatTurn[]): Promise<ChatMessage[]>;
}

// ---------------------------------------------------------------- retrieval

/**
 * Hydrates vector matches back into TextItems: from the original source
 * (slower, always current) or from a DataStore cache. Works from the match,
 * not just its id, so a resolver can use the stored payload (e.g. the URL).
 */
export interface ContentResolver<T extends TextItem = TextItem> {
  /** null when the content is gone (removed, renamed away). */
  resolve(match: VectorQueryResult): Promise<T | null>;
  /** One entry per match, in the same order; null where unresolvable. */
  resolveBatch(matches: VectorQueryResult[]): Promise<(T | null)[]>;
}

export interface SearchResultItem<T extends TextItem = TextItem> {
  item: T;
  score: number;
  scoreKind: ScoreKind;
}

/**
 * Re-orders search results with a finer model (a cross-encoder, an LLM) and
 * keeps the best topK. It may return fewer than topK - only what it judged
 * useful.
 */
export interface Reranker {
  rerank<T extends TextItem>(query: string, results: SearchResultItem<T>[], topK: number): Promise<SearchResultItem<T>[]>;
}

/**
 * Widens each hit before generation - e.g. a paragraph with the paragraphs
 * around it, so the model reads it in context. Exactly one item per result,
 * in the same order (passage [n] stays citation n); the citations stay the hits.
 */
export interface ContextExpander<T extends TextItem = TextItem> {
  expand(results: SearchResultItem<T>[]): Promise<TextItem[]>;
}

/** Candidates for a query, from one kind of index (vectors, keywords...). */
export interface RetrieveOptions {
  topK: number;
  filter?: VectorFilter;
  /**
   * For retrievers whose scores it can be compared with (see
   * SearchOptions.scoreThreshold); keyword retrievers ignore it - an
   * exact-term match is evidence of its own.
   */
  scoreThreshold?: number;
  signal?: AbortSignal;
}

export interface Retriever {
  /** Best first; each match's payload is what a ContentResolver resolves. */
  retrieve(query: string, collection: string, options: RetrieveOptions): Promise<VectorQueryResult[]>;
}

/**
 * More ways to search for one query: e.g. a hypothetical passage that would
 * answer it (HyDE), whose words and embedding are closer to the text that
 * actually answers than the question's are.
 */
export interface QueryExpander {
  expand(query: string, options?: { signal?: AbortSignal }): Promise<string[]>;
}

/** A searchable index of words (BM25 and the like), complementing vectors with exact names and terms. */
export interface KeywordIndex extends Retriever {
  add(collection: string, items: { id: string; text: string; payload: Record<string, unknown> }[]): Promise<void>;
  count(collection: string): Promise<number>;
}

export interface SearchResult<T extends TextItem = TextItem> {
  query: string;
  results: SearchResultItem<T>[];
}

export interface SearchOptions {
  topK?: number;
  /** Narrows the search, e.g. to one work or a collection of works. */
  filter?: VectorFilter;
  /**
   * Drops weak matches: for distances, results farther than this; for
   * similarities, results below it.
   */
  scoreThreshold?: number;
  signal?: AbortSignal;
}

export interface Searcher<T extends TextItem = TextItem> {
  search(query: string, collection: string, options?: SearchOptions): Promise<SearchResult<T>>;
}

// ---------------------------------------------------------------- indexing

export interface IndexingStats {
  processedItems: number;
  /** Items embedded and stored. */
  generatedVectors: number;
  /** Items already stored with the same payload: nothing to do. */
  reusedVectors: number;
  /** Items already stored whose payload changed (e.g. a moved URL): payload updated, vector kept. */
  repointedVectors: number;
  /** Items left out: no usable text, or a language the embedder does not support. */
  skippedItems: number;
  durationMs: number;
}

/** One embedder call, as reported to IndexOptions.onEmbedded. */
export interface EmbeddedBatch {
  items: number;
  chars: number;
  dimension: number;
  durationMs: number;
}

export interface IndexOptions<T extends TextItem> {
  /** Items read and stored together. Default 10 (embedder calls may be smaller: see maxBatchSize). */
  batchSize?: number;
  /** Cuts items into passages before embedding; each passage is stored as its own item. */
  splitter?: TextSplitter;
  /**
   * The text actually embedded for an item, or null to skip it. Default: the
   * item's text, skipped when blank. Whatever it returns is then truncated to
   * the embedder's maxInputChars.
   */
  prepareText?: (text: string, item: T) => string | null;
  /** The payload stored with the vector. Default: indexer.ts's defaultPayload. */
  payloadOf?: (item: T) => Record<string, unknown>;
  /**
   * Reuse stored vectors (default true): an item whose id is already stored is
   * not embedded again - at most its payload is updated. Vectors are costly; a
   * full re-embed of a large corpus takes days.
   */
  reuse?: boolean;
  /** After each embedder call (stats, throttling). */
  onEmbedded?: (batch: EmbeddedBatch) => Promise<void>;
  /** After every batch, whether or not anything was embedded (e.g. keep-alives). */
  afterBatch?: () => Promise<void>;
  /** Checked after each batch: true stops the indexing there. */
  shouldStop?: () => boolean;
  log?: (message: string) => void;
}

export interface Indexer {
  indexSource<T extends TextItem>(source: TextSource<T>, collection: string, options?: IndexOptions<T>): Promise<IndexingStats>;
}

// ---------------------------------------------------------------- RAG and chat

export interface RagResponse<T extends TextItem = TextItem> {
  question: string;
  /** Empty when nothing relevant was found: no generation is attempted then. */
  answer: string;
  /** What the answer was generated from; [n] in the answer is citations[n-1]. */
  citations: SearchResultItem<T>[];
}

/** A streamed answer: the citations first, then the answer as it is generated. */
export interface RagStream<T extends TextItem = TextItem> {
  question: string;
  citations: SearchResultItem<T>[];
  /** Nothing when no citation was found. */
  answer: AsyncIterable<string>;
}

export interface AskOptions extends SearchOptions {
  history?: ChatTurn[];
  /** What to search for, when it differs from the question answered (a rewritten follow-up). */
  retrievalQuery?: string;
}

export interface RagSystem<T extends TextItem = TextItem> {
  ask(question: string, collection: string, options?: AskOptions): Promise<RagResponse<T>>;
  streamAsk(question: string, collection: string, options?: AskOptions): Promise<RagStream<T>>;
}

/**
 * Turns a follow-up ("and what did he do next?") into a question that stands
 * on its own, so retrieval finds what the conversation is about.
 */
export interface QueryRewriter {
  rewrite(message: string, history: ChatTurn[], options?: { signal?: AbortSignal }): Promise<string>;
}

/** Where conversations are kept between messages (memory, a database...). */
export interface ConversationStore {
  /** The turns so far, oldest first; empty for an unknown conversation. */
  history(conversationId: string): Promise<ChatTurn[]>;
  append(conversationId: string, turns: ChatTurn[]): Promise<void>;
  clear(conversationId: string): Promise<void>;
}

export interface ChatRequest {
  /** Continues that conversation; a new one starts without it. */
  conversationId?: string;
  message: string;
  filter?: VectorFilter;
  topK?: number;
  scoreThreshold?: number;
  signal?: AbortSignal;
}

export interface ChatReply<T extends TextItem = TextItem> extends RagResponse<T> {
  conversationId: string;
  /** The message as asked; `question` is what was searched for (rewritten from the conversation). */
  message: string;
}

/** A conversation over a collection: every message answered from what it retrieves. */
export interface Chatbot<T extends TextItem = TextItem> {
  chat(collection: string, request: ChatRequest): Promise<ChatReply<T>>;
}
