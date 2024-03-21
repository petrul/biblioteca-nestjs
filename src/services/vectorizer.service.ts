import { Inject, Injectable } from "@nestjs/common";
import { TextbaseClient } from "./textbase_client.service";
import { Content, ContentEmbedder, PROVIDER_EMBEDDER } from "../model/model";
import { TeiElemDto } from "../textbase.api";

/**
 * central service that  coordinates calling sub-services
 */
@Injectable()
export class VectorizerService {

    pageSize: number;

    constructor(
        protected tbc: TextbaseClient, 
        @Inject(PROVIDER_EMBEDDER) protected embedder: ContentEmbedder, 
        pageSize = 2000) {
            this.pageSize = pageSize;
        }

    async vectorize(divId: number) {

        var hasMorePages = true;
        const gen = this.tbc.getParagraphs(divId, this.pageSize);

        do {
            // page per page
            const crtPage: TeiElemDto[] = [];
            for (let i = 0 ; i < this.pageSize && hasMorePages; i++) {
                const crt = await gen.next();
                hasMorePages = ! crt.done
                const crtValue: TeiElemDto = crt.value as TeiElemDto
                crtPage.push(crtValue);
            }

            const contentArr = crtPage.map<Content>(it => { return {
                text: it.text,
                sha256: it.text_sha256,
                url: it.url,
            }});

            await this.embedder.embeddings(contentArr);


        } while(hasMorePages)


    }
}