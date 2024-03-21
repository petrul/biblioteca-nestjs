import { MilvusCollection } from './milvuscollection.service';
import { TestUtils } from '../../../test/testutils';
import { Util } from '../../util';
import { VectorizerConfiguration as VectorizerConfiguration, commonConf } from '../../configuration';
import { Content } from 'src/model/model';

describe('MilvuscollectionService', () => {
    const conf = TestUtils.testConf;

    it('milvus collection create/drop', async () => {
        const colname = "test_" + TestUtils.randomAlphanumeric()
        let col: MilvusCollection = new MilvusCollection(colname, commonConf as VectorizerConfiguration);
        await col.create();
        await col.drop()
    }, 
    60 * 1000 // 1 min timeout 
    );

    it ('insert data into milvus', async() => {

        const colname = "test_" + TestUtils.randomAlphanumeric()
        const data = Array.from( {length: 10}, (_, __) => {
            const text = TestUtils.randomAlphanumeric(200);
            return {
                text: text,
                url: TestUtils.randomAlphanumeric(),
                sha256: Util.sha256AsHex(text),
                embedding: Array.from( { length: 384}, () => Math.random() )
            }
        });

        const dataLen = data.length;
        const inData = data.slice(0, 5)
        const outData = data.slice(5, 10)
        expect(inData.length).toBe(dataLen / 2)
        expect(outData.length).toBe(dataLen / 2)
        
        let col: MilvusCollection = new MilvusCollection(colname, commonConf as VectorizerConfiguration);
        try {

            await col.create();
            await col.createIndex();
            await col.insert(data.map( ({ text, ...rest }) => rest as Content));

            await col.getCollectionStatistics();
            await col.load();

            const inShas = inData.map(it => it.sha256);
            const alreadyPresent = await col.findById(inShas);

            expect(alreadyPresent.length).toBe(dataLen / 2)
            expect(alreadyPresent.sort()).toEqual(inShas.sort())
                        
        } finally {
            await col.drop();
        }
            
    }, 
    60 * 1000)
});