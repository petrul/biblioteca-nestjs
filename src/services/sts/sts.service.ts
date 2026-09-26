import { Inject, Injectable } from "@nestjs/common";
import { AppConfService, PROVIDER_CONF, VectorizerConfiguration } from "../../configuration";
import { Api as StsApi } from "../../sts.api";
import { Content, ContentEmbedder } from "src/model/model";
import { assert } from "console";

@Injectable()
export class SentenceTransformersService {

    sts: StsApi<string>;

    static readonly NAME_ALL_MINILM_L6_V2 = 'all-MiniLM-L6-v2';
    static readonly NAME_ALL_MPNET_BASE_V2 = 'all-mpnet-base-v2';

    constructor(@Inject(PROVIDER_CONF) protected conf: VectorizerConfiguration) {
        const baseUrl = this.conf.sentenceTransformersServer
        this.sts = new StsApi({
            baseUrl: baseUrl,
            baseApiParams: {
              headers: {
                Accept: 'application/json',
              }
            }
          });
    }

    async getModelNames() : Promise<string[]> {
        const resp = await this.sts.api.getModelNamesApiModelsNamesGet();
        return resp.data;
    }

    async encode(model: string, sentences: string[]): Promise<number[][]> {
        const resp = await this.sts.api.postModelsEncodeApiModelsModelIdEncodePost(model, sentences);
        return resp.data;
    }
}

export interface StsEncoder {
    encode(sentences: string[]) : Promise<number[][]>;
}

@Injectable()
export class AllMpnetBaseV2_StsService implements StsEncoder, ContentEmbedder {

    static readonly modelName = SentenceTransformersService.NAME_ALL_MPNET_BASE_V2;

    // all-mpnet-base-v2 is trained on English sentence-pair/paraphrase data
    // only (sentence-transformers' own model card) - not multilingual.
    readonly supportedLanguages: string[] | 'all' = ['en'];

    // all-mpnet-base-v2: 512-token (word-piece) context - a very
    // conservative ~2 chars per token for English text.
    readonly maxContextChars = 1024;

    constructor(private stsService: SentenceTransformersService) {}

    /**
     * this is the actual api call
     */
    encode(sentences: string[]): Promise<number[][]> {
        return this.stsService.encode(AllMpnetBaseV2_StsService.modelName, sentences);
    }

    /**
     * @param content this is an adapter to Content
     */
    async embeddings(content: Content[]): Promise<Content[]> {
        const sentences = content.map(it => it.text);
        const vectors = await this.encode(sentences);
        assert(vectors.length == sentences.length);
        vectors.forEach((val, i) => {
            const emb = vectors[i];
            assert(emb != null);
            content[i].embedding = emb;
        });
        return content;
    }

}

@Injectable()
export class AllMiniLmL6V2_StsService implements StsEncoder, ContentEmbedder {

    static readonly modelName = SentenceTransformersService.NAME_ALL_MINILM_L6_V2;

    // all-MiniLM-L6-v2 is trained on English sentence-pair data only
    // (sentence-transformers' own model card) - not multilingual, despite
    // being the current production-default embedder (see app.module.ts).
    readonly supportedLanguages: string[] | 'all' = ['en'];

    // all-MiniLM-L6-v2: 256-token (word-piece) context.
    readonly maxContextChars = 512;

    constructor(private stsService: SentenceTransformersService) {}

    /**
     * this is the actual api call
     */
    encode(sentences: string[]): Promise<number[][]> {
        return this.stsService.encode(AllMiniLmL6V2_StsService.modelName, sentences);
    }

    /**
     * @param content this is an adapter to Content
     */
    async embeddings(content: Content[]): Promise<Content[]> {
        const sentences = content.map(it => it.text);
        const vectors = await this.encode(sentences);
        assert(vectors.length == sentences.length);
        vectors.forEach((val, i) => {
            const emb = vectors[i];
            assert(emb != null);
            content[i].embedding = emb;
        });
        return content;
    }

}