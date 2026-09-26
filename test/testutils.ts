import { Util } from "../src/util";
import { VectorizerConfiguration } from "../src/configuration";
import { Content } from "src/model/model";


export class TestUtils {

    protected static randomPossibleAlphanum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    static readonly TIMEOUT_TWO_MINUTES = 2 * 60 * 1000;

    static readonly testConf: Partial<VectorizerConfiguration> = {
        // `rake test` loads biblioteca/dev, whose VECTORSTORE_URL points
        // at the shared prod qdrant (the MILVUS_URL fallback keeps the
        // not-yet-renamed store entries working).
        vectorStoreUrl: process.env.VECTORSTORE_URL || process.env.MILVUS_URL,
        sentenceTransformersServer: process.env.STS_SERVER,
    }

    // The milvus-integration specs (vector_store, milvuscollection,
    // vectorizer) exercise MilvusCollection/MilvusColVectorStore against
    // the dedicated integration-deps Milvus instance - never whatever store
    // VECTORSTORE_URL points the default at (the shared prod qdrant since
    // the MILVUS_URL -> VECTORSTORE_URL migration); the server-side milvus
    // itests pin the same address in their test properties.
    static readonly milvusTestConf: Partial<VectorizerConfiguration> = {
        ...TestUtils.testConf,
        vectorStoreUrl: 'http://srv2.local:20112',
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
