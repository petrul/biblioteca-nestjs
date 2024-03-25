import { MilvusCollection } from './milvuscollection.service';
import { TestUtils } from '../../../test/testutils';
import { VectorizerConfiguration as VectorizerConfiguration, commonConf } from '../../configuration';
import { Content } from 'src/model/model';
import { log } from 'console';
import exp from 'constants';

describe('MilvuscollectionService', () => {
    
    const conf = TestUtils.testConf;
    let col: MilvusCollection;

    beforeEach(async () => {
        const colname = "test_" + TestUtils.randomAlphanumeric()
        col = new MilvusCollection(colname, commonConf as VectorizerConfiguration);
        expect(await col.exists()).toBe(false);
        
        await col.createIfNotExists();
        // await col.create();
        // await col.createIndex();
        expect(await col.exists()).toBe(true);
        // expect(true).toBe(false);
        log(`created collection ${col.name}`)
    })

    afterEach(async () => {
        await col.drop();
        log(`dropped collection ${col.name}`)
    })

    it ('upsert data into milvus', async() => {
            const data = TestUtils.randomContent(10, 384, 200);

            // const dataLen = data.length;
            const firstHalf = data.slice(0, 5);
            const secondHalf = data.slice(5, 10);

            expect(firstHalf.length).toBe(5);
            expect(secondHalf.length).toBe(5);
            
            await col.upsert(firstHalf); // .map( ({ text, ...rest }) => rest as Content));
            await col.flush();
            
            await col.getCollectionStatistics();
            await col.load();

            expect(await col.count()).toEqual(5);

            const inShas = firstHalf.map(it => it.sha256);
            const alreadyPresent = await col.findById(inShas);

            expect(alreadyPresent.length).toBe(5)
            expect(alreadyPresent.sort()).toEqual(inShas.sort())

            const allRows = (await col.findAll()).map(it => it.sha256);
            expect(allRows.sort()).toEqual(inShas.sort());
            expect(await col.count()).toEqual(5);

            // again 
            await col.upsert(firstHalf);
            await col.flush();
            expect(await col.count()).toEqual(5);  
            
            // now upsert all 10, there should be a total of ten
            await col.upsert(data);
            await col.flush();
            expect(await col.count()).toEqual(10);  
                                            
        }, 
        TestUtils.TIMEOUT_TWO_MINUTES
    )
});