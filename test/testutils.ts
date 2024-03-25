import { Util } from "../src/util";
import { VectorizerConfiguration, commonConf } from "../src/configuration";
import { Content } from "src/model/model";


export class TestUtils {

    protected static randomPossibleAlphanum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    static readonly TIMEOUT_TWO_MINUTES = 2 * 60 * 1000;

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
    
    static randomContent(nrElems: number = 10, vectorDim: number = 384, textSize:number = 200): Content[] {
        return Array.from( {length: nrElems}, (_, __) => {
            const text = TestUtils.randomAlphanumeric(textSize);
            return {
                text: text,
                url: TestUtils.randomAlphanumeric(),
                sha256: Util.sha256AsHex(text),
                embedding: Array.from( { length: vectorDim}, () => Math.random() )
            }
        });
    }

}