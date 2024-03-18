import { Injectable } from "@nestjs/common";
import { AppConfService, TextbaseNestjsConfiguration } from "../../configuration";
import { Api as StsApi } from "../../sts.api";

@Injectable()
export class SentenceTransformersService {

    sts: StsApi<string>;

    static readonly NAME_ALL_MINILM_L6_V2 = 'all-MiniLM-L6-v2';
    static readonly NAME_ALL_MPNET_BASE_V2 = 'all-mpnet-base-v2';

    constructor(private conf: AppConfService) {
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
export class All_mpnet_base_v2_StsService  implements StsEncoder {

    readonly modelName = SentenceTransformersService.NAME_ALL_MPNET_BASE_V2;

    constructor(private stsService: SentenceTransformersService) {}

    encode(sentences: string[]): Promise<number[][]> {
        return this.stsService.encode(this.modelName, sentences );
    }

}