import { Embedder, EmbeddingPurpose } from '../core';

export interface OllamaEmbedderOptions {
  url: string;
  model: string;
  dimension: number;
  supportedLanguages?: readonly string[] | 'all';
  /** Default 4000 (bge-m3 under Ollama's default num_batch takes ~2048 tokens). */
  maxInputChars?: number;
  maxBatchSize?: number;
  /** Ollama keep_alive: -1 keeps the model loaded for good. Omitted: Ollama's default. */
  keepAlive?: number;
  /** Prefixes some models expect (e5: 'query: ' / 'passage: '). */
  queryPrefix?: string;
  passagePrefix?: string;
  timeoutMs?: number;
}

/** Embedder over Ollama's batch /api/embed. */
export class OllamaEmbedder implements Embedder {
  private readonly url: string;

  constructor(private readonly options: OllamaEmbedderOptions) {
    this.url = options.url.replace(/\/+$/, '');
  }

  get modelName(): string { return this.options.model; }
  get dimension(): number { return this.options.dimension; }
  get supportedLanguages(): readonly string[] | 'all' { return this.options.supportedLanguages ?? 'all'; }
  get maxInputChars(): number { return this.options.maxInputChars ?? 4000; }
  get maxBatchSize(): number | undefined { return this.options.maxBatchSize; }

  async embedBatch(texts: string[], purpose: EmbeddingPurpose = 'passage'): Promise<number[][]> {
    if (texts.length === 0) return [];
    const prefix = (purpose === 'query' ? this.options.queryPrefix : this.options.passagePrefix) ?? '';
    const response = await fetch(`${this.url}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.options.model,
        input: texts.map((text) => prefix + text),
        ...(this.options.keepAlive !== undefined ? { keep_alive: this.options.keepAlive } : {}),
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 300_000),
    });
    if (!response.ok) throw new Error(`Ollama /api/embed failed for model '${this.options.model}': HTTP ${response.status} ${await response.text()}`);
    const { embeddings } = (await response.json()) as { embeddings?: number[][] };
    if (!embeddings || embeddings.length !== texts.length) {
      throw new Error(`Ollama ${this.options.model} returned ${embeddings?.length ?? 0} embeddings for ${texts.length} texts`);
    }
    return embeddings;
  }

  async embed(text: string, purpose: EmbeddingPurpose = 'passage'): Promise<number[]> {
    return (await this.embedBatch([text], purpose))[0];
  }
}
