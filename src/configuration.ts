
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { log } from "console";

export default () => chooseConf();

export interface VectorizerConfiguration {
    /**
     * collection name for vectorizing textbase paragraphs using the ALL_MPNET_BASE_V2 SentenceTransformers model.
     */
    milvus_collection_tb_all_mpnet_base_v2_paras: string;
    kafkaServers: string;
    sentenceTransformersServer: string;
    miniMilvus: string;
    textbaseUrl: string;
}
export const PROVIDER_CONF = Symbol('VectorizerConfiguration');

export const commonConf : Partial<VectorizerConfiguration> = {
    kafkaServers: process.env.KAFKA_SERVERS || "kafka:9092",
    sentenceTransformersServer: process.env.STS_SERVER || "http://mini.local:11200",
    miniMilvus: process.env.MINI_MILVUS  || 'mini:19530',
    textbaseUrl: process.env.TEXTBASE_URL || "http://textbase-server:8080",
    milvus_collection_tb_all_mpnet_base_v2_paras: process.env.MLVCOL_TB_PARAS_ALL_MPNET_BASE_V2 || 'tb_paras_all_mpnet_base_v2'
}

const prodConf: VectorizerConfiguration = {
    kafkaServers: commonConf.kafkaServers,
    sentenceTransformersServer: commonConf.sentenceTransformersServer,
    miniMilvus: commonConf.miniMilvus,
    textbaseUrl: commonConf.textbaseUrl,
    milvus_collection_tb_all_mpnet_base_v2_paras: commonConf.milvus_collection_tb_all_mpnet_base_v2_paras
}

// local dev conf for yoga laptop workstation
const yogaConf: VectorizerConfiguration = {
    kafkaServers: 'localhost:30115',
    sentenceTransformersServer: commonConf.sentenceTransformersServer,
    miniMilvus: commonConf.miniMilvus,
    textbaseUrl: commonConf.textbaseUrl,
    milvus_collection_tb_all_mpnet_base_v2_paras: commonConf.milvus_collection_tb_all_mpnet_base_v2_paras
}

const yoga2ProdConf: VectorizerConfiguration = {
    kafkaServers: 'srv2.local:9028', // kafka prod
    sentenceTransformersServer: commonConf.sentenceTransformersServer,
    miniMilvus: commonConf.miniMilvus,
    textbaseUrl: commonConf.textbaseUrl,
    milvus_collection_tb_all_mpnet_base_v2_paras: commonConf.milvus_collection_tb_all_mpnet_base_v2_paras
}

const yoga2IntConf: VectorizerConfiguration = {
    kafkaServers: 'mini.local:10106', // kafka tb int
    sentenceTransformersServer: commonConf.sentenceTransformersServer,
    miniMilvus: commonConf.miniMilvus,
    textbaseUrl: 'http://mini.local:10101',
    milvus_collection_tb_all_mpnet_base_v2_paras: 'int_tb_all_mpnet_base_v2_paras'
}

/**
 * @returns 
 */
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

    get miniMilvus(): string {
        return this.conf.get<string>('miniMilvus');
    }

    get textbaseUrl(): string {
        return this.conf.get<string>('textbaseUrl');
    }

    get milvus_collection_tb_all_mpnet_base_v2_paras(): string {
        return this.conf.get<string>('milvus_collection_tb_all_mpnet_base_v2_paras');
    }
}
