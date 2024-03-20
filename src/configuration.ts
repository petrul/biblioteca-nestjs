
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export default () => chooseConf();

export interface VectorizerConfiguration {
    kafkaServers: string;
    sentenceTransformersServer: string;
    miniMilvus: string;
    textbaseUrl: string;
}

export const commonConf : Partial<VectorizerConfiguration> = {
    sentenceTransformersServer: process.env.STS_SERVER || "http://mini.local:11200",
    miniMilvus: process.env.MINI_MILVUS  || 'mini:19530',
    textbaseUrl: "https://textbase.scriptorium.ro"
}

const prodConf: VectorizerConfiguration = {
    kafkaServers: process.env.KAFKA_SERVERS || "kafka:9052",
    sentenceTransformersServer: commonConf.sentenceTransformersServer,
    miniMilvus: commonConf.miniMilvus,
    textbaseUrl: commonConf.textbaseUrl
}

// local dev conf for yoga laptop workstation
const yogaConf: VectorizerConfiguration = {
    kafkaServers: 'localhost:30115',
    sentenceTransformersServer: commonConf.sentenceTransformersServer,
    miniMilvus: commonConf.miniMilvus,
    textbaseUrl: commonConf.textbaseUrl
}

/**
 * @returns 
 */
function chooseConf() {
    var os = require('os');
    const hostname: string = os.hostname();
    if ('yoga' == hostname.toLowerCase())
        return yogaConf;
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
}
