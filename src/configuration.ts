
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { log } from "console";
import { MilvusCollection } from "./services/milvus/milvuscollection.service";

export default () => chooseConf();

/**
 * The non-secret shared-resource naming convention textbase-server exports
 * from GET /api/admin/config -- see AdminRestController.config() there.
 * textbase-nestjs has no configuration of its own for any of this (no env
 * var, no hardcoded default): it fetches this once at startup (see
 * app.module.ts's PROVIDER_SHARED_CONFIG) and uses it directly, so the two
 * services structurally cannot disagree on which Kafka topic, Milvus
 * collection, or embedding model to use.
 */
export interface SharedTextbaseConfig {
    kafka: {
        newOpusImportedTopic: string;
        opusReimportedTopic: string;
    };
    milvus: {
        collection: string;
    };
    embedder: {
        // canonical Milvus-collection-naming-convention identifier, e.g. "QWEN3_EMBEDDING_4B"
        model: string;
        // the actual Ollama model tag to call /api/embed with, e.g. "qwen3-embedding:4b" -
        // absent if textbase-server's active embedder isn't Ollama-backed.
        ollamaModel?: string;
        host?: string;
        port?: number;
    };
}

export interface VectorizerConfiguration {

    /**
     * collection name for vectorizing textbase paragraphs using the ALL_MPNET_BASE_V2 SentenceTransformers model.
     * i.e. tb_paras_all_mpnet_base_v2 - kept around for the embedder still available under its own name
     * (see AllMpnetBaseV2_StsService), an alternate embedder nothing currently wires up as the
     * active PROVIDER_EMBEDDER (see SharedTextbaseConfig for what textbase-server actually expects).
     */
    milvus_collection_tb_all_mpnet_base_v2_paras: string;
    milvus_collection_tb_all_mpnet_base_v2_paras_dim: number;

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
export const PROVIDER_SHARED_CONFIG = Symbol('SharedTextbaseConfig');

export const commonConf : VectorizerConfiguration = {
    kafkaServers: process.env.KAFKA_SERVERS || "kafka:9092",
    sentenceTransformersServer: process.env.STS_SERVER || "http://mini.local:11200",
    ollamaServer: process.env.OLLAMA_SERVER || "http://zmeu.local:11434",
    // 19530 is Milvus's raw default port, but this LAN's mini.local instance is
    // published on 20112 instead (confirmed against textbase-server's own
    // application-dev/ci.properties, which use the same host+port for the
    // same Milvus instance) - 19530 is simply unreachable here.
    miniMilvus: process.env.MINI_MILVUS  || 'mini:20112',
    textbaseUrl: process.env.TEXTBASE_URL || "http://textbase-server:8080",
    milvus_collection_tb_all_mpnet_base_v2_paras: process.env.MLVCOL_TB_PARAS_ALL_MPNET_BASE_V2 || 'tb_paras_all_mpnet_base_v2',
    milvus_collection_tb_all_mpnet_base_v2_paras_dim: MilvusCollection.DIM_768,
    tb_getParas_pageSize: parseInt(process.env.TB_GETPARAS_PAGE_SIZE) || 2000
}

const prodConf: VectorizerConfiguration = { ...commonConf,
    // production's own Milvus instance is on zmeu.local:19530 (its default
    // port), NOT the shared mini.local:20112 dev/ci/int one commonConf
    // otherwise defaults to - confirmed against textbase-server's own
    // application-prod.properties (milvus.host=zmeu.local, milvus.port=19530).
    miniMilvus: process.env.MINI_MILVUS || 'zmeu.local:19530',
}

// local dev conf for yoga laptop workstation
const yogaConf: VectorizerConfiguration = { ...commonConf, 
    kafkaServers: 'localhost:30115', 
}

const yoga2ProdConf: VectorizerConfiguration = { ...commonConf,
    kafkaServers: 'srv2.local:9028', // kafka prod
}

const yoga2IntConf: VectorizerConfiguration = { ...commonConf,
    kafkaServers: 'mini.local:10106', // kafka tb int
    textbaseUrl: 'http://mini.local:10101',
    milvus_collection_tb_all_mpnet_base_v2_paras: 'int_tb_all_mpnet_base_v2_paras',
    tb_getParas_pageSize: 200
}

function chooseConf() {
    var os = require('os');
    const hostname: string = os.hostname();
    log(`==> hostname: ` + hostname);
    if ('yoga' == hostname.toLowerCase())
        // return yogaConf;
        // return yoga2ProdConf;
        return yoga2IntConf;
    return prodConf;
}

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
}
