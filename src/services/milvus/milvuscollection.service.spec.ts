import { MilvusCollection } from './milvuscollection.service';
import { TestUtils } from '../../../test/testutils';
import { VectorizerConfiguration } from '../../configuration';
import { Content } from 'src/model/model';
import { log } from 'console';

describe('MilvuscollectionService', () => {
    
    const conf = TestUtils.testConf;
    let col: MilvusCollection;

    beforeEach(async () => {
        const colname = "test_" + TestUtils.randomAlphanumeric()
        col = new MilvusCollection(colname, conf as VectorizerConfiguration);
        expect(await col.exists()).toBe(false);
        
        await col.createIfNotExists();
        // await col.create();
        // await col.createIndex();
        expect(await col.exists()).toBe(true);
        // expect(true).toBe(false);
        log(`created collection ${col.name}`)
    })

    afterEach(async () => {
        try {
            log(`will drop ${col.name}...`);
            await col.drop();
            log(`dropped collection ${col.name}`)
        } finally {
            col.close();
        }
    }, TestUtils.TIMEOUT_TWO_MINUTES)

    it ('upsert data into milvus', async() => {
            const data = TestUtils.randomContent(10, MilvusCollection.DIM_384, 200);

            const firstHalf = data.slice(0, 5);
            const secondHalf = data.slice(5, 10);

            expect(firstHalf.length).toBe(5);
            expect(secondHalf.length).toBe(5);
            
            await col.upsert(firstHalf);
            await col.flush();
            
            await col.getCollectionStatistics();
            await col.load();

            expect(await col.count()).toEqual(5);

            const inShas = firstHalf.map(it => it.sha256);
            const alreadyPresent = (await col.findById(inShas)).map(it => it.sha256);

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
            const mresp = await col.upsert(data);
            expect(parseInt(mresp.insert_cnt)).toEqual(10);
            await col.flush();
            expect(await col.count()).toEqual(10);
            

            //
            {
                // two updated records
                data[0].url = TestUtils.randomAlphanumeric();
                data[3].url = TestUtils.randomAlphanumeric();
                const newOrModified = await col.newOrModified(data);
                expect(newOrModified.length).toEqual(2);

                data.push(TestUtils.randomContent(1)[0]); // new element altogether
                expect(data.length).toBe(11);
                expect((await col.newOrModified(data)).length).toBe(3);

                const mresp = await col.upsertNewOrModified(data);
                expect(parseInt(mresp.insert_cnt)).toEqual(3);
                expect(await col.count()).toEqual(11);
            }

        },
        TestUtils.TIMEOUT_TWO_MINUTES
    )

    it('getVectorDimension reflects the actual collection, assertVectorDimensionMatches throws on mismatch', async () => {
        expect(await col.getVectorDimension()).toEqual(MilvusCollection.DIM_384);
        await expect(col.assertVectorDimensionMatches(MilvusCollection.DIM_384)).resolves.toBeUndefined();
        await expect(col.assertVectorDimensionMatches(MilvusCollection.DIM_768)).rejects.toThrow(/vector dimension/);
    });

    it('persists useful comments on the collection and every field', async () => {
        expect(await col.getDescription()).toContain(col.name);
        const comments = await col.getFieldDescriptions();
        expect(comments[MilvusCollection.SHA256]).toMatch(/SHA-256.*deduplicate/i);
        expect(comments[MilvusCollection.URL]).toMatch(/Textbase API URL.*retrieve/i);
        expect(comments[MilvusCollection.EMBEDDING]).toMatch(/same encoder and dimension/i);
    });
});
