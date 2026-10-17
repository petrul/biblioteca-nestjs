import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';

/**
 * Basic unit of text worth indexing and retrieving.
 */
export interface TextItem {
  id: string;
  sourceId: string;
  url: string;
  metadata: Record<string, unknown>;
  getContentStream(): Promise<ReadableStream<Uint8Array> | Readable>;
  getText(): Promise<string>;
}

/**
 * In-memory implementation of a TextItem for finite/buffered data with deterministic content hashing.
 */
export class MemTextItem implements TextItem {
  public readonly id: string;

  constructor(
    public readonly sourceId: string,
    public readonly url: string,
    private readonly content: string,
    public readonly metadata: Record<string, unknown> = {},
    customId?: string
  ) {
    this.id = customId ?? MemTextItem.computeHash(url, content);
  }

  public static computeHash(url: string, content: string): string {
    return createHash('sha256')
      .update(`${url}::${content}`)
      .digest('hex');
  }

  async getContentStream(): Promise<Readable> {
    return Readable.from([this.content]);
  }

  async getText(): Promise<string> {
    return this.content;
  }
}

/**
 * Async iterable stream of TextItems supporting batching.
 */
export interface TextIterable<T extends TextItem = TextItem> extends AsyncIterable<T> {
  getBatches(batchSize: number): AsyncIterable<T[]>;
}

/**
 * Represents a data source (website, API, DB, Digital Library).
 */
export interface TextSource<T extends TextItem = TextItem> {
  readonly id: string;
  readonly name: string;
  getItems(): TextIterable<T>;
  getItemById(id: string): Promise<T | null>;
}

/**
 * Vector representation record for QDrant / Milvus.
 */
export interface VectorRecord {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface VectorQueryResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

/**
 * Vector Store abstraction (e.g., QDrant).
 */
export interface VectorStore {
  upsert(collection: string, records: VectorRecord[]): Promise<void>;
  query(collection: string, vector: number[], topK: number): Promise<VectorQueryResult[]>;
}

/**
 * Key-Value / Document Data Store abstraction (e.g., Cassandra).
 */
export interface DataStore<T extends TextItem = TextItem> {
  save(item: T): Promise<void>;
  saveBatch(items: T[]): Promise<void>;
  findById(id: string): Promise<T | null>;
  findByIds(ids: string[]): Promise<T[]>;
}

/**
 * Text Embedder abstraction (e.g., Ollama qwen-embedder).
 */
export interface Embedder {
  readonly modelName: string;
  readonly dimension: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

/**
 * LLM Text Generator abstraction (e.g., Ollama qwen3.5 / Llama3.1 / OpenAI).
 */
export interface Generator {
  readonly modelName: string;
  generate(prompt: string, context: TextItem[]): Promise<string>;
  streamGenerate(prompt: string, context: TextItem[]): AsyncIterable<string>;
}

/**
 * Content Resolver to hydrate vector match IDs back into TextItems.
 */
export interface ContentResolver<T extends TextItem = TextItem> {
  resolve(vectorId: string): Promise<T>;
  resolveBatch(vectorIds: string[]): Promise<T[]>;
}

/**
 * Core Indexing stats metadata.
 */
export interface IndexingStats {
  processedItems: number;
  generatedVectors: number;
  durationMs: number;
}

export interface SearchResultItem<T extends TextItem = TextItem> {
  item: T;
  score: number;
}

export interface SearchResult<T extends TextItem = TextItem> {
  query: string;
  results: SearchResultItem<T>[];
}

export interface RagResponse<T extends TextItem = TextItem> {
  question: string;
  answer: string;
  citations: T[];
}