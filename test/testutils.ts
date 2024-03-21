import { VectorizerConfiguration, commonConf } from "../src/configuration";


export class TestUtils {

    protected static randomPossibleAlphanum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    static readonly testConf: Partial<VectorizerConfiguration> = {
        textbaseUrl: commonConf.textbaseUrl,
        miniMilvus: commonConf.miniMilvus,
        sentenceTransformersServer: commonConf.sentenceTransformersServer,
    }
    
    static randomAlphanumeric(n: number = 10) {
        let text = '';
    
        for (let i = 0; i < n; i++) {
          text += TestUtils.randomPossibleAlphanum.charAt(Math.floor(
            Math.random() * TestUtils.randomPossibleAlphanum.length));
        }
    
        return text;
    }


}