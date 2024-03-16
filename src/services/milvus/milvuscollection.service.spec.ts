import { Test } from '@nestjs/testing';
import { MilvusCollection } from './milvuscollection.service';
import { TestUtils } from '../../../test/testutils';
import { log } from 'console';

describe('MilvuscollectionService', () => {
    // let col: MilvusCollection = new MilvusCollection();

    // beforeEach(async () => {
    //     const moduleRef = await Test.createTestingModule({
    //         imports: [], // Add
    //         controllers: [], // Add
    //         providers: [MilvusCollection],   // Add
    //     }).compile();

    //     // col = moduleRef.get<MilvusCollection>(MilvusCollection);
    // });

    it('should be defined', async () => {
        // expect(col).toBeDefined();
        const colname = "test_" + TestUtils.randomAlphanumeric()
        let col: MilvusCollection = new MilvusCollection(colname);
        console.log(await col.create())
        console.log(await col.drop())
    });
});
