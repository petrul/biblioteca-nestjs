import { Test } from '@nestjs/testing';
import { MilvusColVectorStore, VectorStore } from './vector_store';
import { PROVIDER_LOGGER } from '../util';
import { PROVIDER_CONF, VectorizerConfiguration } from '../configuration';
import { ConsoleLogger } from '@nestjs/common';
import { TestUtils } from '../../test/testutils';
import { MilvusCollection } from './milvus/milvuscollection.service';
import { log } from 'console';

describe('VectorStore', () => {
    const conf = TestUtils.testConf;
    let vectorStore: MilvusColVectorStore;
    let col: MilvusCollection;
    let colname: string;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [],
            controllers: [],
            providers: [
                {
                    provide: PROVIDER_LOGGER,
                    useClass: ConsoleLogger
                },
                
                {
                    provide: PROVIDER_CONF,
                    useValue: conf
                },
                {
                    provide: MilvusCollection,
                    useFactory: (conf: VectorizerConfiguration) => {
                      colname = "test_" + TestUtils.randomAlphanumeric(10);
                      return new MilvusCollection(colname, conf);
                    },
                    inject: [PROVIDER_CONF]
                  },
                  MilvusColVectorStore,
        
            ],
        }).compile();

        vectorStore = moduleRef.get<MilvusColVectorStore>(MilvusColVectorStore);
        col = moduleRef.get<MilvusCollection>(MilvusCollection);
        await col.create();
        // await col.load();
    });

    afterEach(async () => {
        await col.drop();
      })

    it('should be defined', async () => {
        expect(vectorStore).toBeDefined();
        expect(col).toBeDefined();
        expect(col).toBe(vectorStore.collection)

        const nrElems = 10
        const content = TestUtils.randomContent(nrElems);
        expect(content.length).toBeGreaterThan(0)
        // log(content);

        const nr = await vectorStore.store(content);
        console.log(nr);

        const call2Resp = await vectorStore.store(content); // again
        log(call2Resp);

        log(await col.findById(content.map(it => it.sha256)));
        expect(col.milvus).toBeDefined();
        await col.createIndex();
        await col.load();
        expect(await col.count()).toEqual(nrElems);

    });
});
