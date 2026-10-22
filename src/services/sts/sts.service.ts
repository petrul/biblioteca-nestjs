import { Inject, Injectable } from "@nestjs/common";
import { AppConfService, PROVIDER_CONF, VectorizerConfiguration } from "../../configuration";
import { Api as StsApi } from "../../sts.api";
import { Embedder } from "../../ragtime/core";

@Injectable()
export class SentenceTransformersService {

    sts: StsApi<string>;

    static readonly NAME_ALL_MINILM_L6_V2 = 'all-MiniLM-L6-v2';
    static readonly NAME_ALL_MPNET_BASE_V2 = 'all-mpnet-base-v2';

    constructor(@Inject(PROVIDER_CONF) protected conf: VectorizerConfiguration) {
        // Optional since STS was retired (see configuration.ts) - never
        // selected as the active embedder today.
        const baseUrl = this.conf.sentenceTransformersServer ?? ''
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
export class AllMpnetBaseV2_StsService implements StsEncoder, Embedder {

    static readonly modelName = SentenceTransformersService.NAME_ALL_MPNET_BASE_V2;

    // all-mpnet-base-v2 is trained on English sentence-pair/paraphrase data
    // only (sentence-transformers' own model card) - not multilingual.
    readonly supportedLanguages: string[] | 'all' = ['en'];

    // all-mpnet-base-v2: 512-token (word-piece) context - a very
    // conservative ~2 chars per token for English text.
    readonly maxInputChars = 1024;

    readonly dimension = 768;

    get modelName(): string { return AllMpnetBaseV2_StsService.modelName; }

    constructor(private stsService: SentenceTransformersService) {}

    /**
     * this is the actual api call
     */
    encode(sentences: string[]): Promise<number[][]> {
        return this.stsService.encode(AllMpnetBaseV2_StsService.modelName, sentences);
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        return texts.length === 0 ? [] : this.encode(texts);
    }

    async embed(text: string): Promise<number[]> {
        return (await this.embedBatch([text]))[0];
    }

}

@Injectable()
export class AllMiniLmL6V2_StsService implements StsEncoder, Embedder {

    static readonly modelName = SentenceTransformersService.NAME_ALL_MINILM_L6_V2;

    // all-MiniLM-L6-v2 is trained on English sentence-pair data only
    // (sentence-transformers' own model card) - not multilingual, despite
    // being the current production-default embedder (see app.module.ts).
    readonly supportedLanguages: string[] | 'all' = ['en'];

    // all-MiniLM-L6-v2: 256-token (word-piece) context.
    readonly maxInputChars = 512;

    readonly dimension = 384;

    get modelName(): string { return AllMiniLmL6V2_StsService.modelName; }

    constructor(private stsService: SentenceTransformersService) {}

    /**
     * this is the actual api call
     */
    encode(sentences: string[]): Promise<number[][]> {
        return this.stsService.encode(AllMiniLmL6V2_StsService.modelName, sentences);
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        return texts.length === 0 ? [] : this.encode(texts);
    }

    async embed(text: string): Promise<number[]> {
        return (await this.embedBatch([text]))[0];
    }

}