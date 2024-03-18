import { AppConfService } from "src/configuration";

export class SentenceTransformersService {

    constructor(private conf: AppConfService) {
        const stsurl = this.conf.sentenceTransformersServer
    }
}