
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MilvusCollection } from "./services/milvus/milvuscollection.service";

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
}

function requiredInteger(name: string): number {
    const raw = required(name);
    const value = Number.parseInt(raw, 10);
    if (!Number.isInteger(value) || value <= 0)
        throw new Error(`${name} must be a positive integer, received '${raw}'`);
    return value;
}

export default (): VectorizerConfiguration => ({
    kafkaServers: required('KAFKA_SERVERS'),
    kafkaTopic: required('KAFKA_TOPIC'),
    kafkaGroupId: required('KAFKA_GROUP_ID'),
    sentenceTransformersServer: required('STS_SERVER'),
    ollamaServer: required('OLLAMA_SERVER'),
    miniMilvus: required('MINI_MILVUS'),
    textbaseUrl: required('TEXTBASE_URL'),
    milvus_collection_tb_all_mpnet_base_v2_paras: required('MLVCOL_TB_PARAS_ALL_MPNET_BASE_V2'),
    milvus_collection_tb_all_mpnet_base_v2_paras_dim: MilvusCollection.DIM_768,
    milvus_collection_tb_qwen3_embedding_4b_paras: required('MLVCOL_TB_PARAS_QWEN3_EMBEDDING_4B'),
    milvus_collection_tb_qwen3_embedding_4b_paras_dim: MilvusCollection.DIM_2560,
    milvus_collection_tb_bge_m3_paras: required('MLVCOL_TB_PARAS_BGE_M3'),
    milvus_collection_tb_bge_m3_paras_dim: MilvusCollection.DIM_1024,
    milvus_collection_textbase_sts_all_minilm_l6_v2_paras: required('MLVCOL_TEXTBASE_PARAS_STS_ALL_MINILM_L6_V2'),
    milvus_collection_textbase_sts_all_minilm_l6_v2_paras_dim: MilvusCollection.DIM_384,
    tb_getParas_pageSize: requiredInteger('TB_GETPARAS_PAGE_SIZE'),
});

export interface VectorizerConfiguration {

    /**
     * collection name for vectorizing textbase paragraphs using the ALL_MPNET_BASE_V2 SentenceTransformers model.
     * i.e. tb_paras_all_mpnet_base_v2 - kept around for the embedder still available under its own name
     * (see AllMpnetBaseV2_StsService), even though it's no longer the default PROVIDER_EMBEDDER.
     */
    milvus_collection_tb_all_mpnet_base_v2_paras: string;
    milvus_collection_tb_all_mpnet_base_v2_paras_dim: number;

    /**
     * collection name for vectorizing textbase paragraphs using Qwen3-Embedding-4B (via Ollama).
     * Retained for explicit use, but BGE-M3 is the default PROVIDER_EMBEDDER.
     * i.e. tb_paras_qwen3_embedding_4b
     */
    milvus_collection_tb_qwen3_embedding_4b_paras: string;
    milvus_collection_tb_qwen3_embedding_4b_paras_dim: number;

    /**
     * Paragraph vectors produced by the multilingual bge-m3 model through
     * Ollama. This is the default collection/provider.
     */
    milvus_collection_tb_bge_m3_paras: string;
    milvus_collection_tb_bge_m3_paras_dim: number;

    /**
     * collection name for vectorizing textbase paragraphs using STS's
     * all-MiniLM-L6-v2 model. Retained as an explicitly injectable embedder;
     * BGE-M3 is the default PROVIDER_EMBEDDER.
     * i.e. textbase_paras_sts_all_minilm_l6_v2
     */
    milvus_collection_textbase_sts_all_minilm_l6_v2_paras: string;
    milvus_collection_textbase_sts_all_minilm_l6_v2_paras_dim: number;

    //the address of kafka
    kafkaServers: string;

    // Topic carrying newly imported Textbase works and this consumer's group.
    kafkaTopic: string;
    kafkaGroupId: string;

    // this is the address of the STS server, i.e. mini.local:xxx
    sentenceTransformersServer: string;

    // the Ollama server backing BGE-M3, Qwen3-Embedding-4B and nomic-embed-text (see services/ollama) -
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

/**
 * typed extension to ConfigService for our properties.
 */
@Injectable()
export class AppConfService implements VectorizerConfiguration {
    constructor (private conf: ConfigService) {}
    
    get kafkaServers(): string {
        return this.conf.get<string>('kafkaServers');
    }

    get kafkaTopic(): string {
        return this.conf.get<string>('kafkaTopic');
    }

    get kafkaGroupId(): string {
        return this.conf.get<string>('kafkaGroupId');
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

    get milvus_collection_tb_bge_m3_paras(): string {
        return this.conf.get<string>('milvus_collection_tb_bge_m3_paras');
    }

    get milvus_collection_tb_bge_m3_paras_dim(): number {
        return this.conf.get<number>('milvus_collection_tb_bge_m3_paras_dim');
    }

    get milvus_collection_textbase_sts_all_minilm_l6_v2_paras(): string {
        return this.conf.get<string>('milvus_collection_textbase_sts_all_minilm_l6_v2_paras');
    }

    get milvus_collection_textbase_sts_all_minilm_l6_v2_paras_dim(): number {
        return this.conf.get<number>('milvus_collection_textbase_sts_all_minilm_l6_v2_paras_dim');
    }
}
