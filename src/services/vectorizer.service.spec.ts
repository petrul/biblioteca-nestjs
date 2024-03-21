import { Test, TestingModule } from '@nestjs/testing';

import { VectorizerService } from './vectorizer.service';
import { TextbaseClient } from './textbase_client.service';
import { PROVIDER_CONF, VectorizerConfiguration } from '../configuration';
import { TestUtils } from '../../test/testutils';
import { ContentEmbedder, PROVIDER_EMBEDDER } from '../model/model';
import { AllMpnetBaseV2_StsService, SentenceTransformersService } from './sts/sts.service';
import { MilvusCollection } from './milvus/milvuscollection.service';
import { MilvusColVectorStore } from './vector_store';

describe('VectorizerService', () => {
  
  const conf = TestUtils.testConf;

  let vectServ: VectorizerService;
  let tbc: TextbaseClient;
  const testMilvusCollectionName = "test_" + TestUtils.randomAlphanumeric(10);

  beforeEach(async () => {

    const app: TestingModule = await Test.createTestingModule({
        providers: [
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
  });

  describe('vectorizer', () => {
    it('vectorizer should work', async () => {
      const opera = await tbc.getAllOpera(0, 5);
      
      const op = opera[0]
      expect(op.id).toBeGreaterThan(0);

      vectServ.vectorize(op.id)
      console.log('done');
      

    });
  });
});
