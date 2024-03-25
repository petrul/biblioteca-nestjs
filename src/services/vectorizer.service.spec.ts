import { Test, TestingModule } from '@nestjs/testing';

import { VectorizerService } from './vectorizer.service';
import { TextbaseClient } from './textbase_client.service';
import { PROVIDER_CONF, VectorizerConfiguration } from '../configuration';
import { TestUtils } from '../../test/testutils';
import { ContentEmbedder, PROVIDER_EMBEDDER } from '../model/model';
import { AllMpnetBaseV2_StsService, SentenceTransformersService } from './sts/sts.service';
import { MilvusCollection } from './milvus/milvuscollection.service';
import { MilvusColVectorStore } from './vector_store';
import { ConsoleLogger } from '@nestjs/common';
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
            useClass: AllMpnetBaseV2_StsService
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
          TextbaseClient,
          {
            provide: VectorizerService,
            useFactory: (tbc: TextbaseClient, embedder: ContentEmbedder , vecstore: MilvusColVectorStore ) => {
              return new VectorizerService(tbc, embedder, vecstore);
            },
            inject: [TextbaseClient, PROVIDER_EMBEDDER, MilvusColVectorStore]
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
    await col.drop();
  })

  describe('vectorizer', () => {
    it('vectorizer should work', async () => {
      // const opera = await tbc.getAllOpera(0, 5);
      const op = await tbc.getElemByPath('/stoker/the_snake_s_pass');
      expect(op.path).toEqual('stoker/the_snake_s_pass');

      const maxElems = 20;
      const nrElems = await vectServ.vectorize(op.id, 0, maxElems);

      log('nr processed elems', nrElems);
      expect(nrElems).toBeGreaterThan(0);
      expect(nrElems).toBeLessThanOrEqual(maxElems);

    },
    TestUtils.TIMEOUT_TWO_MINUTES);
  });
});
