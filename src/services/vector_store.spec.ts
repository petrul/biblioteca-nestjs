import { Test } from '@nestjs/testing';
import { MilvusColVectorStore, VectorStore } from './vector_store';
import { PROVIDER_LOGGER } from '../util';
import { PROVIDER_CONF, VectorizerConfiguration } from '../configuration';
import { ConsoleLogger } from '@nestjs/common';
import { TestUtils } from '../../test/testutils';
import { MilvusCollection } from './milvus/milvuscollection.service';
import { log } from 'console';
import { Content } from 'src/model/model';

describe('VectorStore', () => {
    jest.setTimeout(TestUtils.TIMEOUT_TWO_MINUTES * 2);
    const conf = TestUtils.milvusTestConf;
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
        await col.createIndex();
        await col.load();
        log(`created and loaded col ${col.name}`)
    });

    afterEach(async () => {
        try {
            await col.drop();
            log(`dropped col ${col.name}`);
        } finally {
            col.close();
        }
      })

    it('basic store', async () => {
        expect(vectorStore).toBeDefined();
        expect(col).toBeDefined();
        expect(col).toBe(vectorStore.collection)

        const nrElems = 10
        const content = TestUtils.randomContent(nrElems);
        expect(content.length).toBeGreaterThan(0)

        await vectorStore.store(content);
        // console.log(nr);

        await vectorStore.store(content); // again
        // log(call2Resp);

        await col.findById(content.map(it => it.sha256));
        expect(col.milvus).toBeDefined();
        await col.createIndex();
        await col.load();
        expect(await col.count()).toEqual(nrElems);

    },
    TestUtils.TIMEOUT_TWO_MINUTES * 2);

    it('removeOpus removes only the matching opus, not a similarly-prefixed sibling', async () => {
        const opusA: Content[] = [
            { sha256: 'a-p0', url: 'seneca/de-vita/p0', embedding: TestUtils.randomContent(1)[0].embedding, text: null },
            { sha256: 'a-p1', url: 'seneca/de-vita/p1', embedding: TestUtils.randomContent(1)[0].embedding, text: null },
        ];
        // Deliberately a URL that starts with opusA's own path as a plain
        // string prefix but is a distinct opus - same reasoning as
        // LuceneIndexServiceResumeTest's sibling-prefix test server-side.
        const opusB: Content[] = [
            { sha256: 'b-p0', url: 'seneca/de-vita-longa/p0', embedding: TestUtils.randomContent(1)[0].embedding, text: null },
        ];

        await vectorStore.store([...opusA, ...opusB]);
        expect(await col.count()).toEqual(3);

        await vectorStore.removeOpus('seneca/de-vita');
        await col.flush();

        const remaining = await col.findAll(['sha256', 'url']);
        expect(remaining.map(it => it.sha256)).toEqual(['b-p0']);
    },
    TestUtils.TIMEOUT_TWO_MINUTES * 2);

    it('modify url', async () => {
        const nrElems = 10
        const content = TestUtils.randomContent(nrElems);
        content.forEach ((it) => {expect(it.sha256).toBeTruthy()}); // non-empty urls
        content.forEach ((it) => {expect(it.url).toBeTruthy()}); // non-empty urls
        content.forEach ((it) => {expect(it.embedding).toBeTruthy()}); // non-empty urls

        let originalUrls: string[];

        {
            // 1
            await vectorStore.store(content);

            const all = await col.findAll(['sha256', 'url']);
            originalUrls = all.map(it => it.url)
            originalUrls.forEach ((it) => {expect(it).toBeTruthy()}); // non-empty urls
            expect(new Set(originalUrls)).toEqual(new Set(content.map(it => it.url)));
            expect(all.length).toEqual(nrElems);
        }


        {
            // 2
            const contentWithChangedUrls: Content[] = content.map((it, idx) => { return {
                sha256: it.sha256,
                url: 'http://' + idx, // changed the initial random value with idx
                embedding: it.embedding,
                text: null
            }});
            // log(contentWithChangedUrls);
            await vectorStore.store(contentWithChangedUrls);
            const all = await col.findAll(['sha256', 'url', 'embedding']);
            const newUrls: String[] = all.map(it => it.url)
            const embs = all.map(it => it.embedding)
            // log(newUrls);
            newUrls.forEach(it => {
                expect(it).toBeTruthy();
                expect(it.startsWith('http:'));
            })
            embs.forEach(it => { expect(it).toBeTruthy();});

            expect(new Set(originalUrls)).not.toEqual(new Set(newUrls));
        }

    },
    TestUtils.TIMEOUT_TWO_MINUTES * 2)
});
