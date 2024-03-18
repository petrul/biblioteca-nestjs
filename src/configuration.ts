import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export default () => chooseConf();

export interface TextbaseNestjsConfiguration {
    kafkaServers: string;
    sentenceTransformersServer: string;
}

export const commonConf : Partial<TextbaseNestjsConfiguration> = {
    sentenceTransformersServer: process.env.STS_SERVER || "http://mini.local:11200"
}

const prodConf: TextbaseNestjsConfiguration = {
    kafkaServers: process.env.KAFKA_SERVERS || "kafka:9052",
    sentenceTransformersServer: commonConf.sentenceTransformersServer
}

const yogaConf: TextbaseNestjsConfiguration = {
    kafkaServers: 'localhost:30115',
    sentenceTransformersServer: commonConf.sentenceTransformersServer
}

function chooseConf() {
    var os = require('os');
    const hostname: string = os.hostname();
    if ('yoga' == hostname.toLowerCase())
        return yogaConf;
    return prodConf;
}

@Injectable()
export class AppConfService implements TextbaseNestjsConfiguration {
    constructor (private conf: ConfigService) {}
    
    get kafkaServers(): string {
        return this.conf.get<string>('kafkaServers');
    }

    get sentenceTransformersServer(): string {
        return this.conf.get<string>('sentenceTransformersServer');
    }
    
}
