import { LoggerService } from "@nestjs/common";
import { Embedder, EmbeddingPurpose } from "../ragtime/core";
import { retryUntilAvailable } from "../util";

/**
 * Wraps any Embedder (sentence-transformers, Ollama-backed, whichever) so
 * that if it's unreachable, embedding waits and retries (see
 * retryUntilAvailable) instead of throwing straight away - and instead of
 * the caller (the batch loop of the indexer) hammering it with one failed
 * call per batch for nothing while it's down.
 */
export class RetryingEmbedder implements Embedder {

    constructor(
        protected inner: Embedder,
        protected logger: LoggerService,
        protected pollIntervalMs = 5000,
    ) {}

    embedBatch(texts: string[], purpose?: EmbeddingPurpose): Promise<number[][]> {
        return retryUntilAvailable(
            () => this.inner.embedBatch(texts, purpose),
            this.logger,
            'Embedder',
            this.pollIntervalMs,
        );
    }

    async embed(text: string, purpose?: EmbeddingPurpose): Promise<number[]> {
        return (await this.embedBatch([text], purpose))[0];
    }

    get maxBatchSize(): number | undefined {
        return this.inner.maxBatchSize;
    }

    get modelName(): string {
        return this.inner.modelName;
    }

    get dimension(): number {
        return this.inner.dimension;
    }

    get supportedLanguages(): readonly string[] | 'all' {
        return this.inner.supportedLanguages;
    }

    get maxInputChars(): number {
        return this.inner.maxInputChars;
    }
}
