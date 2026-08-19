import { LoggerService } from "@nestjs/common";
import { Content, ContentEmbedder } from "../model/model";
import { retryUntilAvailable } from "../util";

/**
 * Wraps any ContentEmbedder (sentence-transformers, Ollama-backed,
 * whichever) so that if it's unreachable, embeddings() waits and retries
 * (see retryUntilAvailable) instead of throwing straight away - and instead
 * of the caller (the per-page loop in VectorizerService) hammering it with
 * one failed call per page for nothing while it's down.
 */
export class RetryingContentEmbedder implements ContentEmbedder {

    constructor(
        protected inner: ContentEmbedder,
        protected logger: LoggerService,
        protected pollIntervalMs = 5000,
    ) {}

    embeddings(content: Content[]): Promise<Content[]> {
        return retryUntilAvailable(
            () => this.inner.embeddings(content),
            this.logger,
            'Embedder',
            this.pollIntervalMs,
        );
    }
}
