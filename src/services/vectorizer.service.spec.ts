import { Test, TestingModule } from '@nestjs/testing';

import { VectorizerService } from './vectorizer.service';
import { TextbaseClient } from './textbase_client.service';
import { FakeTextbaseClient } from '../../test/fake-textbase-client';
import { PROVIDER_CONF, VectorizerConfiguration } from '../configuration';
import { TestUtils } from '../../test/testutils';
import { ContentEmbedder, PROVIDER_EMBEDDER } from '../model/model';
import { AllMiniLmL6V2_StsService, SentenceTransformersService } from './sts/sts.service';
import { MilvusCollection } from './milvus/milvuscollection.service';
import { MilvusColVectorStore } from './vector_store';
import { ConsoleLogger, LoggerService } from '@nestjs/common';
import { PROVIDER_LOGGER } from '../util';
import { log } from 'console';

describe('VectorizerService', () => {
  
  const conf = TestUtils.testConf;

  let vectServ: VectorizerService;
  let tbc: TextbaseClient;
  let col: MilvusCollection;

  beforeEach(async () => {

    const app: TestingModule = await Test.createTestingModule({
        providers: [
          {
            provide: PROVIDER_LOGGER,
            useClass: ConsoleLogger
          },
          {
            provide: PROVIDER_CONF,
            useValue: conf
          },
          SentenceTransformersService,
          {
            provide: PROVIDER_EMBEDDER,
            useClass: AllMiniLmL6V2_StsService
          },
          {
            provide: MilvusCollection,
            useFactory: (conf: VectorizerConfiguration) => {
              const name = "test_" + TestUtils.randomAlphanumeric(10)
              return new MilvusCollection(name, conf);
            },
            inject: [PROVIDER_CONF]
          },
          MilvusColVectorStore,
          {
            // no live textbase-server reachable from here right now - see
            // FakeTextbaseClient's own docstring
            provide: TextbaseClient,
            useClass: FakeTextbaseClient,
          },
          {
            provide: VectorizerService,
            useFactory: (tbc: TextbaseClient, embedder: ContentEmbedder , vecstore: MilvusColVectorStore, logger: LoggerService) => {
              return new VectorizerService(tbc, embedder, vecstore, logger);
            },
            inject: [TextbaseClient, PROVIDER_EMBEDDER, MilvusColVectorStore, PROVIDER_LOGGER]
          }
        ],
    }).compile();

    vectServ = app.get<VectorizerService>(VectorizerService);
    tbc = app.get<TextbaseClient>(TextbaseClient);
    col = app.get<MilvusCollection>(MilvusCollection);
    await col.create();
    await col.createIndex();
    await col.load();
  });

  afterEach(async () => {
    try {
      await col.drop();
    } finally {
      col.close();
    }
  })

    it('vectorizer should work', async () => {
      const op = await tbc.getElemByPath('/stoker/the_snake_s_pass');
      expect(op.path).toEqual('stoker/the_snake_s_pass');

      var interPagewasCalled = false;

      const maxElems = 20;
      const nrElems = await vectServ.vectorize(op.id, 
        () => { 
          interPagewasCalled = true; 
          return Promise.resolve(); }, 
        0, maxElems);

      log('nr processed elems', nrElems);
      expect(nrElems).toBeGreaterThan(0);
      expect(nrElems).toBeLessThanOrEqual(maxElems);
      expect(interPagewasCalled).toBeTruthy();

    },
    TestUtils.TIMEOUT_TWO_MINUTES);

    it('skips French paragraphs (all-MiniLM-L6-v2 is English-only) but embeds English ones',
    async () => {
      const op = await tbc.getElemByPath('/stoker/the_snake_s_pass');

      // FakeTextbaseClient yields 3 synthetic English paragraphs followed by
      // 20 real French ones (Durkheim) - a large enough limit to pull all 23
      // confirms the French ones are actively filtered out by language, not
      // just never reached.
      const nrElems = await vectServ.vectorize(op.id, undefined, 0, 100);

      expect(nrElems).toEqual(3);

      const stored = await col.findAll([MilvusCollection.SHA256, MilvusCollection.URL]);
      expect(stored.length).toEqual(3);
      stored.forEach((it: any) => expect(it.url).toContain('english_fixture'));
    },
    TestUtils.TIMEOUT_TWO_MINUTES);
});
