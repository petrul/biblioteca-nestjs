import { Inject, Injectable, LoggerService, OnModuleInit } from "@nestjs/common";
import { TextbaseClient } from "./textbase_client.service";
import { Content, ContentEmbedder, PROVIDER_EMBEDDER } from "../model/model";
import { TeiElemDto } from "../textbase.api";
import { assert } from "console";
import { PROVIDER_VECTOR_STORE, VectorStore } from "./vector_store";
import { StopWatch, Util } from "../util";

/**
 * central service that  coordinates calling sub-services to get paragraphs, ask for their
 * embedding and then store them.
 */
@Injectable()
export class VectorizerService implements OnModuleInit {

    pageSize: number;

    /**
     * @param pageSize same value is used for all paged services: the textbase client,
     * the embedder (sentence transformer service) and the vector store.
     */
    constructor(
        protected tbc: TextbaseClient,
        @Inject(PROVIDER_EMBEDDER) protected embedder: ContentEmbedder,
        @Inject(PROVIDER_VECTOR_STORE) protected vecstore: VectorStore,
        protected log: LoggerService,
        pageSize = 2000) {
            this.pageSize = pageSize;
        }

    /**
     * KafkaListenerService depends on this service, so Nest constructs (and
     * runs onModuleInit on) this one first - meaning this blocks Kafka
     * message consumption from starting until the embedder is confirmed
     * reachable, not just Milvus (already checked in the MilvusCollection
     * provider factory in app.module.ts). PROVIDER_EMBEDDER is wrapped in
     * RetryingContentEmbedder, so a throwaway call here already waits and
     * retries on failure - this just makes sure that happens at startup
     * instead of on the first real Kafka message.
     */
    async onModuleInit() {
        await this.embedder.embeddings([
            { text: 'startup healthcheck', url: 'startup-healthcheck', sha256: 'startup-healthcheck' },
        ]);
        this.log.log('Embedder confirmed available at startup.');
    }

    /**
     * @param offset skipping the initial offset elements (usable for paging)
     * @param limit only process a maximum of limit (usable for paging)
     * @param divId this should be the id of an opus, but it can be really any div id (even smaller).
     * @param interPageJob do this after each processed page (usable for kafka heartbeats)
     * @returns the nr of processed elements 
     */
    async vectorize(divId: number, 
        interPageJob: () => Promise<any> = () => { return Promise.resolve();  },
        offset = 0, limit = Number.POSITIVE_INFINITY, 
    ) : Promise<number> {

        var processed = 0;

        var hasMore = true;
        const gen = this.tbc.getParagraphs(divId, this.pageSize, offset, limit);

        let i = 0;
        for (; i < offset; i++) {
            const next = await gen.next();
            if (next.done) {
                return 
            }
        }

        do {
            // page per page so that we can ask embeddings per page.
            const crtPage: TeiElemDto[] = [];
            for (let i = 0 ; (i < this.pageSize) && hasMore ; i++) {
                const crt = await gen.next();                
                if (!crt.done) {
                    const crtValue: TeiElemDto = crt.value as TeiElemDto
                    crtPage.push(crtValue);
                }
                hasMore = ! crt.done
            }

            const contentArr = crtPage.map<Content>(it => { return {
                text:     it.text,
                sha256:   it.text_sha256,
                url:      it.url,
                language: it.language,
            }});
            const filtered = contentArr.filter(it =>
                    it.text != null
                    && it.sha256 != null
                    && it.url != null
                    && it.text.length > 10
                    && it.text.length < 3000
            );

            assert (filtered.length <= this.pageSize);

            // Only embed what this specific encoder can actually make sense
            // of - e.g. the STS models are English-only (see
            // AllMiniLmL6V2_StsService.supportedLanguages) despite being the
            // production default, so non-English paragraphs would otherwise
            // silently get embedded through a model that was never trained
            // on their language, producing vectors that look valid but carry
            // no real semantic meaning. Unknown language (undetected) is
            // treated the same as unsupported - conservative on purpose.
            const supported = this.embedder.supportedLanguages;
            const embeddable = filtered.filter(it =>
                supported === 'all' || (it.language != null && supported.includes(it.language))
            );
            if (embeddable.length != filtered.length) {
                this.log.log(`skipping ${filtered.length - embeddable.length} of ${filtered.length} paras: `
                    + `language not supported by this encoder (supports: ${supported})`);
            }

            if (embeddable.length > 0) {

                var watch = new StopWatch();

                await this.embedder.embeddings(embeddable);
                const embedMs = watch.elapsedMs();
                this.log.log(`embedding ${embeddable.length} paras took ${watch}`);

                watch = new StopWatch();
                // await this.vecstore.store(embeddable);
                await this.vecstore.storeNewOrUpdated(embeddable);
                this.log.log(`storing ${embeddable.length} vectors took ${watch}`);

                await this.vecstore.flush();

                // Keep the encoder's CPU from being pegged continuously - wait
                // roughly as long as that batch's embedding call itself took
                // (e.g. 100 paragraphs taking 20s means a ~20s pause) before
                // starting the next one, deliberately trading throughput for
                // not exhausting the (shared, CPU-bound) sentence-transformers
                // server. Timed off the embed call specifically, not the
                // store+flush steps above, since those run against Milvus,
                // not the encoder.
                if (embedMs > 0) {
                    this.log.log(`pausing ${embedMs}ms before the next batch`);
                    await Util.delay(embedMs);
                }
            }

            processed += embeddable.length;

            await interPageJob();

        } while(hasMore && i < (offset + limit))


        // flush at the end of the opus
        await this.vecstore.flush();

        return processed;
    }
}