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
     * @param offset do not vectoize all paragraphs of the given divId but only
     * after skipping the initial offset
     * @param limit 
     */
    async vectorize(divId: number, offset = 0, limit = Number.POSITIVE_INFINITY) {

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
                text: it.text,
                sha256: it.text_sha256,
                url: it.url,
            }});

            assert (contentArr.length <= this.pageSize);
            
            await this.embedder.embeddings(contentArr);

            await this.vecstore.store(contentArr);

        } while(hasMore && i < offset + limit)


    }
}