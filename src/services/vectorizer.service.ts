import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { BibliotecaClient } from "./biblioteca_client.service";
import { PROVIDER_SHARED_CONFIG, SharedTextbaseConfig } from "../configuration";
import { StopWatch, Util } from "../util";
import { Embedder, GenericIndexer } from "../ragtime/core";
import { BibliotecaDivSource, BibliotecaPayload, bibliotecaPayload, normalizeOpusPath } from "../biblioteca-rag/biblioteca.source";
import { BibliotecaVectorCollection, PROVIDER_EMBEDDER, PROVIDER_VECTOR_COLLECTION } from "../biblioteca-rag/ragtime.providers";

/**
 * Vectorizes Biblioteca works: ragtime's GenericIndexer over a work's
 * paragraphs (BibliotecaDivSource), embedding into the paragraph collection
 * only what is not stored yet.
 */
@Injectable()
export class VectorizerService implements OnModuleInit {

    pageSize: number;
    private stopRequested = false;
    private readonly log = new Logger("vectorizer");

    /** Called at the start of a fresh run so a previous stop doesn't carry over. */
    clearStop(): void {
        this.stopRequested = false;
    }

    /** Halts the current and any in-progress vectorize() after its current batch. */
    requestStop(): void {
        this.stopRequested = true;
        this.log.log('Stop requested - will halt after the current batch.');
    }

    isStopRequested(): boolean {
        return this.stopRequested;
    }

    /** Deletes one work's vectors - an exact match on its 'author/opus' path, never a prefix. */
    async removeOpus(opusPath: string): Promise<void> {
        const path = normalizeOpusPath(opusPath ?? '');
        if (!path.includes('/'))
            throw new Error(`Cannot remove vectors for '${opusPath}': not an author/opus path`);
        await this.vectors.store.delete(this.vectors.name, { [BibliotecaPayload.OPUS_PATH]: path });
        this.log.log(`Removed vectors for opus ${path}`);
    }

    /**
     * @param pageSize same value is used for all paged services: the biblioteca
     * client, the embedder and the vector store.
     */
    constructor(
        protected tbc: BibliotecaClient,
        @Inject(PROVIDER_EMBEDDER) protected embedder: Embedder,
        @Inject(PROVIDER_VECTOR_COLLECTION) protected vectors: BibliotecaVectorCollection,
        @Inject(PROVIDER_SHARED_CONFIG) protected shared: SharedTextbaseConfig,
        pageSize = 2000) {
            this.pageSize = pageSize;
        }

    /**
     * VectorizerKafkaListenerService depends on this service, so Nest constructs (and
     * runs onModuleInit on) this one first - meaning this blocks Kafka
     * message consumption from starting until the embedder is confirmed
     * reachable, not just Milvus (already checked in the MilvusCollection
     * provider factory in app.module.ts). PROVIDER_EMBEDDER is wrapped in
     * RetryingEmbedder, so a throwaway call here already waits and
     * retries on failure - this just makes sure that happens at startup
     * instead of on the first real Kafka message.
     */
    async onModuleInit() {
        await this.embedder.embed('startup healthcheck');
        this.log.log('Embedder confirmed available at startup.');
    }

    /**
     * @param divId this should be the id of an opus, but it can be really any div id (even smaller).
     * @param interPageJob do this after each processed page (usable for kafka heartbeats)
     * @param offset skipping the initial offset elements (usable for paging)
     * @param limit only process a maximum of limit (usable for paging)
     * @returns the nr of processed (embeddable) paragraphs, embedded now or before
     */
    async vectorize(divId: number,
        interPageJob: () => Promise<any> = () => Promise.resolve(),
        offset = 0, limit = Number.POSITIVE_INFINITY,
    ) : Promise<number> {
        const opusWatch = new StopWatch();
        let totalBatches = 0;

        // Paragraph size window from the server's shared config
        // (vectorizer.para.* in its application.properties): the
        // too-short are corpus noise and get skipped; the too-long are
        // truncated to maxChars - NOT dropped - so long expository
        // paragraphs and <table> blocks stay searchable. The indexer also
        // clamps to the embedder's own maxInputChars, so a raised maxChars
        // can never overflow the model. The id stays the FULL source
        // paragraph's sha256 either way: it is the row's identity for the
        // reimport dedup, not a digest of what got embedded.
        //
        // Only paragraphs in a language this encoder supports are embedded
        // (unknown language counts as unsupported - conservative on
        // purpose): see ragtime's embeds().
        //
        // "Vectors are precious": a full corpus embed takes days, not an
        // index rebuild - the indexer asks the store which paragraphs
        // already have a vector (by sha256, the row's identity). A
        // reimport that renames the book changes every url but no text:
        // those paragraphs are repointed to their new urls and NONE of them
        // re-embedded; only genuinely new/changed paragraphs cost an
        // embedder call.
        const minChars = this.shared.paragraph.minChars;
        const maxChars = this.shared.paragraph.maxChars;
        const indexer = new GenericIndexer(this.embedder, this.vectors.store);
        const stats = await indexer.indexSource(
            new BibliotecaDivSource(this.tbc, divId, { pageSize: this.pageSize, offset, limit }),
            this.vectors.name,
            {
                batchSize: this.pageSize,
                prepareText: (text) => text.length > minChars ? text.slice(0, maxChars) : null,
                payloadOf: bibliotecaPayload,
                onEmbedded: async (batch) => {
                    totalBatches++;
                    this.log.log(`embedding and storing ${batch.items} paras took ${batch.durationMs}ms of embedding`);
                    await this.tbc.recordEmbeddingBatchStat({
                        batchSize: batch.items,
                        totalChars: batch.chars,
                        vectorDimension: batch.dimension,
                        embedderModel: this.shared.embedder.model,
                        durationMs: batch.durationMs,
                    });
                    // Keep the encoder from being pegged continuously - wait
                    // roughly as long as that batch's embedding call itself
                    // took (e.g. 100 paragraphs taking 20s means a ~20s
                    // pause) before the next one, deliberately trading
                    // throughput for not exhausting the shared encoder.
                    // Timed off the embed call specifically, not the store
                    // step, since that runs against the store.
                    if (batch.durationMs > 0) {
                        this.log.log(`pausing ${batch.durationMs}ms before the next batch`);
                        await Util.delay(batch.durationMs);
                    }
                },
                afterBatch: interPageJob,
                shouldStop: () => this.stopRequested,
                log: (message) => this.log.log(message),
            });

        await this.tbc.recordOpusVectorizingStat({
            opusId: divId,
            totalParas: stats.processedItems,
            totalBatches,
            embedderModel: this.shared.embedder.model,
            durationMs: opusWatch.elapsedMs(),
        });

        return stats.processedItems;
    }
}
