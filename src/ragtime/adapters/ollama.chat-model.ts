import { ChatMessage, ChatModel, CompletionOptions } from '../core';
import { DEFAULT_GENERATION_MODEL, OllamaGenerativeModelFinder } from './ollama.model-finder';

/**
 * The same /api/chat options as editii-translator's GENERATION_OPTIONS -
 * one request shape for every client of the shared Ollama. num_ctx is
 * explicit: Ollama's server default could silently truncate the context.
 */
export const GENERATION_OPTIONS = Object.freeze({
  temperature: 0.7,
  top_p: 0.8,
  top_k: 20,
  min_p: 0,
  presence_penalty: 0,
  repeat_penalty: 1.2,
  repeat_last_n: 256,
  num_ctx: 8192,
  num_predict: 4096,
});

export interface OllamaChatModelOptions {
  url: string;
  /** The model used when no generating model is loaded (or always, when fixed). Default qwen3.5:9b. */
  defaultModel?: string;
  /**
   * 'loaded' (default): an OllamaGenerativeModelFinder picks the generating
   * model Ollama already has loaded, else defaultModel; 'fixed': always
   * defaultModel (comparable runs).
   */
  modelChoice?: 'loaded' | 'fixed';
  /** A finder shared with other clients; one is made from url/defaultModel otherwise. */
  finder?: OllamaGenerativeModelFinder;
  options?: Record<string, unknown>;
  timeoutMs?: number;
  /** How long a picked model is reused before asking Ollama again. Default 60 s. */
  modelPickTtlMs?: number;
}

/** Aborts when either signal does. */
function eitherSignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  for (const signal of [a, b]) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/** ChatModel over Ollama's /api/chat. */
export class OllamaChatModel implements ChatModel {
  private readonly url: string;
  private readonly finder?: OllamaGenerativeModelFinder;

  constructor(private readonly options: OllamaChatModelOptions) {
    this.url = options.url.replace(/\/+$/, '');
    if (options.modelChoice !== 'fixed') {
      this.finder = options.finder
        ?? new OllamaGenerativeModelFinder({ url: options.url, defaultModel: options.defaultModel, ttlMs: options.modelPickTtlMs });
    }
  }

  /** The model of the latest (or next) call. */
  get modelName(): string {
    return this.finder?.current ?? this.options.defaultModel ?? DEFAULT_GENERATION_MODEL;
  }

  pickModel(): Promise<string> {
    return this.finder ? this.finder.find() : Promise.resolve(this.modelName);
  }

  private async chat(messages: ChatMessage[], options: CompletionOptions, stream: boolean): Promise<Response> {
    const model = await this.pickModel();
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 300_000);
    const response = await fetch(`${this.url}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream,
        think: false,
        options: { ...(this.options.options ?? GENERATION_OPTIONS), ...(options.deterministic ? { temperature: 0 } : {}) },
        ...(options.json ? { format: 'json' } : {}),
        messages,
      }),
      signal: options.signal ? eitherSignal(options.signal, timeout) : timeout,
    });
    if (!response.ok) {
      this.finder?.invalidate(); // a model that vanished or cannot chat: find again next time
      throw new Error(`Ollama chat with ${model} failed: HTTP ${response.status} ${await response.text()}`);
    }
    return response;
  }

  async complete(messages: ChatMessage[], options: CompletionOptions = {}): Promise<string> {
    const response = await this.chat(messages, options, false);
    const { message } = (await response.json()) as { message?: { content?: string } };
    if (typeof message?.content !== 'string') throw new Error('Ollama chat returned no message');
    return message.content;
  }

  async *stream(messages: ChatMessage[], options: CompletionOptions = {}): AsyncIterable<string> {
    const response = await this.chat(messages, options, true);
    if (!response.body) throw new Error('Ollama chat returned no body');
    const decoder = new TextDecoder();
    let buffered = '';
    const parse = (line: string): string | undefined => {
      const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string };
      if (chunk.error) throw new Error(`Ollama chat failed: ${chunk.error}`);
      return chunk.message?.content || undefined;
    };
    // newline-delimited JSON: one {message: {content}} object per chunk
    for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffered += decoder.decode(bytes, { stream: true });
      let newline: number;
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        const content = line ? parse(line) : undefined;
        if (content) yield content;
      }
    }
    const content = buffered.trim() ? parse(buffered.trim()) : undefined;
    if (content) yield content;
  }
}
