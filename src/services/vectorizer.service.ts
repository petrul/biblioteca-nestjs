import { Inject, Injectable } from "@nestjs/common";
import { TextbaseClient } from "./textbase_client.service";
import { Content, ContentEmbedder, PROVIDER_EMBEDDER } from "../model/model";
import { TeiElemDto } from "../textbase.api";
import { assert } from "console";
import { PROVIDER_VECTOR_STORE, VectorStore } from "./vector_store";

/**
 * central service that  coordinates calling sub-services to get paragraphs, ask for their
 * embedding and then store them.
 */
@Injectable()
export class VectorizerService {

    pageSize: number;

    /**
     * @param pageSize same value is used for all paged services: the textbase client,
     * the embedder (sentence transformer service) and the vector store. 
     */
    constructor(
        protected tbc: TextbaseClient, 
        @Inject(PROVIDER_EMBEDDER) protected embedder: ContentEmbedder, 
        @Inject(PROVIDER_VECTOR_STORE) protected vecstore: VectorStore,
        pageSize = 2000) {
            this.pageSize = pageSize;
        }

    /**
     * @param offset skipping the initial offset elements (usable for paging)
     * @param limit only process a maximum of limit (usable for paging)
     * @param divId this should be the id of an opus, but it can be really any div id (even smaller).
     * @returns the nr of processed elements 
     */
    async vectorize(divId: number, offset = 0, limit = Number.POSITIVE_INFINITY) : Promise<number> {

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
                text:   it.text,
                sha256: it.text_sha256,
                url:    it.url,
            }});
            const filtered = contentArr.filter(it =>    
                    it.text != null 
                    && it.sha256 != null
                    && it.url != null
                    && it.text.length > 10 
                    && it.text.length < 3000
            );

            assert (filtered.length <= this.pageSize);
            
            await this.embedder.embeddings(filtered);
            await this.vecstore.store(filtered);
            await this.vecstore.flush();

            processed += filtered.length;

        } while(hasMore && i < (offset + limit))


        // flush at the end of the opus
        this.vecstore.flush();

        return processed;
    }
}