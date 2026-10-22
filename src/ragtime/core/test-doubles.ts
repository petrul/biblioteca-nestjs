import { createHash } from 'node:crypto';
import { ChatMessage, ChatModel, CompletionOptions, Embedder, EmbeddingPurpose } from './model';

/**
 * Deterministic stand-ins for the models, for tests of anything built on
 * ragtime: no network, same input, same output.
 */

/**
 * Bag-of-words embedder: each word adds 1 to a hashed dimension, then the
 * vector is normalized. Texts sharing words are near each other, which is
 * enough for retrieval tests.
 */
export class KeywordEmbedder implements Embedder {
  readonly calls: { texts: string[]; purpose?: EmbeddingPurpose }[] = [];

  constructor(
    readonly dimension = 64,
    readonly supportedLanguages: readonly string[] | 'all' = 'all',
    readonly maxInputChars = 100_000,
    readonly maxBatchSize?: number,
    readonly modelName = 'keywords',
  ) {}

  vectorOf(text: string): number[] {
    const vector = new Array(this.dimension).fill(0);
    for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
      vector[createHash('sha256').update(word).digest().readUInt32BE(0) % this.dimension] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }

  async embedBatch(texts: string[], purpose?: EmbeddingPurpose): Promise<number[][]> {
    this.calls.push({ texts, purpose });
    return texts.map((text) => this.vectorOf(text));
  }

  async embed(text: string, purpose?: EmbeddingPurpose): Promise<number[]> {
    return (await this.embedBatch([text], purpose))[0];
  }

  /** Every text embedded so far, in order. */
  embeddedTexts(): string[] {
    return this.calls.flatMap((call) => call.texts);
  }
}

/** A ChatModel answering from a script (a function of the messages), recording what it was sent. */
export class ScriptedChatModel implements ChatModel {
  readonly calls: { messages: ChatMessage[]; options?: CompletionOptions }[] = [];

  constructor(
    private readonly script: (messages: ChatMessage[]) => string = () => 'an answer [1]',
    readonly modelName = 'scripted',
  ) {}

  async complete(messages: ChatMessage[], options?: CompletionOptions): Promise<string> {
    this.calls.push({ messages, options });
    return this.script(messages);
  }

  async *stream(messages: ChatMessage[], options?: CompletionOptions): AsyncIterable<string> {
    const answer = await this.complete(messages, options);
    for (const word of answer.split(/(?<= )/)) yield word;
  }
}
