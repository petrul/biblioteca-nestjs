import { Util } from "../src/util";
import { VectorizerConfiguration } from "../src/configuration";
import { VectorRecord } from "../src/ragtime/core";


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

    static randomAlphanumeric(n: number = 10) {
        let text = '';
    
        for (let i = 0; i < n; i++) {
          text += TestUtils.randomPossibleAlphanum.charAt(Math.floor(
            Math.random() * TestUtils.randomPossibleAlphanum.length));
        }
    
        return text;
    }
    
    /**
     * Random Biblioteca-shaped vector records: real sha256 ids (Qdrant point
     * ids derive from them) and the {sha256, url, opus_path} payload.
     */
    static randomRecords(nrElems: number = 10, vectorDim: number = 384, opusPath = 'author/opus'): VectorRecord[] {
        return Array.from( {length: nrElems}, (_, idx) => {
            const sha256 = Util.sha256AsHex(TestUtils.randomAlphanumeric(200));
            const url = `http://server:8080/${opusPath}/chapter/_${idx + 1}`;
            return {
                id: sha256,
                vector: Array.from( { length: vectorDim}, () => Math.random() ),
                payload: { sha256, url, opus_path: opusPath },
            };
        });
    }

}
