
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { log } from "console";

export default () => chooseConf();

export interface VectorizerConfiguration {
    
    /**
     * collection name for vectorizing textbase paragraphs using the ALL_MPNET_BASE_V2 SentenceTransformers model.
     * i.e. tb_paras_all_mpnet_base_v2
     */
    milvus_collection_tb_all_mpnet_base_v2_paras: string;

    //the address of kafka 
    kafkaServers: string;

    // this is the address of the STS server, i.e. mini.local:xxx
    sentenceTransformersServer: string;

    // this is the mini milvus server: mini.local:xxx
    miniMilvus: string;

    // this is the textbase url (i.e. https://textbase.scriptorium.ro)
    textbaseUrl: string;

    // this is the page size of the call to get paragraphs, it is also the number of page for the nr o paragraphs
    // sent to the sts
    tb_getParas_pageSize: number;
}
export const PROVIDER_CONF = Symbol('VectorizerConfiguration');

export const commonConf : VectorizerConfiguration = {
    kafkaServers: process.env.KAFKA_SERVERS || "kafka:9092",
    sentenceTransformersServer: process.env.STS_SERVER || "http://mini.local:11200",
    miniMilvus: process.env.MINI_MILVUS  || 'mini:19530',
    textbaseUrl: process.env.TEXTBASE_URL || "http://textbase-server:8080",
    milvus_collection_tb_all_mpnet_base_v2_paras: process.env.MLVCOL_TB_PARAS_ALL_MPNET_BASE_V2 || 'tb_paras_all_mpnet_base_v2',
    tb_getParas_pageSize: parseInt(process.env.TB_GETPARAS_PAGE_SIZE) || 2000
}

const prodConf: VectorizerConfiguration = { ...commonConf,}

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
}
