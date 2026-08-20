
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MilvusCollection } from "./services/milvus/milvuscollection.service";

export default configuration;

export interface VectorizerConfiguration {

    /**
     * collection name for vectorizing textbase paragraphs using the ALL_MPNET_BASE_V2 SentenceTransformers model.
     * i.e. tb_paras_all_mpnet_base_v2 - kept around for the embedder still available under its own name
     * (see AllMpnetBaseV2_StsService), even though it's no longer the default PROVIDER_EMBEDDER.
     */
    milvus_collection_tb_all_mpnet_base_v2_paras: string;
    milvus_collection_tb_all_mpnet_base_v2_paras_dim: number;

    /**
     * collection name for vectorizing textbase paragraphs using Qwen3-Embedding-4B (via Ollama) -
     * the default PROVIDER_EMBEDDER now, replacing the sentence-transformers one above.
     * i.e. tb_paras_qwen3_embedding_4b
     */
    milvus_collection_tb_qwen3_embedding_4b_paras: string;
    milvus_collection_tb_qwen3_embedding_4b_paras_dim: number;

    //the address of kafka
    kafkaServers: string;

    // this is the address of the STS server, i.e. mini.local:xxx
    sentenceTransformersServer: string;

    // the Ollama server backing Qwen3-Embedding-4B and nomic-embed-text (see services/ollama) -
    // one fixed instance, unlike sentenceTransformersServer/miniMilvus which vary per environment.
    ollamaServer: string;

    // this is the mini milvus server: mini.local:xxx
    miniMilvus: string;

    // this is the textbase url (i.e. https://textbase.scriptorium.ro)
    textbaseUrl: string;

    // this is the page size of the call to get paragraphs, it is also the number of page for the nr o paragraphs
    // sent to the sts
    tb_getParas_pageSize: number;
}
export const PROVIDER_CONF = Symbol('VectorizerConfiguration');

export function configuration(): VectorizerConfiguration {
    return {
        kafkaServers: process.env.KAFKA_SERVERS || "kafka:9092",
        sentenceTransformersServer: process.env.STS_SERVER || "http://mini.local:11200",
        ollamaServer: process.env.OLLAMA_SERVER || "http://zmeu.local:11434",
        miniMilvus: process.env.MINI_MILVUS || 'mini.local:20112',
        textbaseUrl: process.env.TEXTBASE_URL || "http://textbase-server:8080",
        milvus_collection_tb_all_mpnet_base_v2_paras: process.env.MLVCOL_TB_PARAS_ALL_MPNET_BASE_V2 || 'tb_paras_all_mpnet_base_v2',
        milvus_collection_tb_all_mpnet_base_v2_paras_dim: MilvusCollection.DIM_768,
        milvus_collection_tb_qwen3_embedding_4b_paras: process.env.MLVCOL_TB_PARAS_QWEN3_EMBEDDING_4B || 'tb_paras_qwen3_embedding_4b',
        milvus_collection_tb_qwen3_embedding_4b_paras_dim: MilvusCollection.DIM_2560,
        tb_getParas_pageSize: parseInt(process.env.TB_GETPARAS_PAGE_SIZE) || 2000,
    };
}

export const commonConf: VectorizerConfiguration = configuration();

/**
 * typed extension to ConfigService for our properties.
 */
@Injectable()
export class AppConfService implements VectorizerConfiguration {
    constructor (private conf: ConfigService) {}
    
    get kafkaServers(): string {
        return this.conf.get<string>('kafkaServers');
    }

    get sentenceTransformersServer(): string {
        return this.conf.get<string>('sentenceTransformersServer');
    }

    get ollamaServer(): string {
        return this.conf.get<string>('ollamaServer');
    }

    get miniMilvus(): string {
        return this.conf.get<string>('miniMilvus');
    }

    get textbaseUrl(): string {
        return this.conf.get<string>('textbaseUrl');
    }

    get milvus_collection_tb_all_mpnet_base_v2_paras(): string {
        return this.conf.get<string>('milvus_collection_tb_all_mpnet_base_v2_paras');
    }

    get tb_getParas_pageSize(): number {
        return this.conf.get<number>('tb_getParas_pageSize');
    }

    get milvus_collection_tb_all_mpnet_base_v2_paras_dim(): number {
        return this.conf.get<number>('milvus_collection_tb_all_mpnet_base_v2_paras_dim');
    }

    get milvus_collection_tb_qwen3_embedding_4b_paras(): string {
        return this.conf.get<string>('milvus_collection_tb_qwen3_embedding_4b_paras');
    }

    get milvus_collection_tb_qwen3_embedding_4b_paras_dim(): number {
        return this.conf.get<number>('milvus_collection_tb_qwen3_embedding_4b_paras_dim');
    }
}
