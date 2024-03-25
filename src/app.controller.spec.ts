import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { TextbaseClient } from './services/textbase_client.service';
import { TestUtils } from '../test/testutils';
import { PROVIDER_CONF, VectorizerConfiguration } from './configuration';
import { AllMpnetBaseV2_StsService, SentenceTransformersService } from './services/sts/sts.service';
import { ContentEmbedder, PROVIDER_EMBEDDER } from './model/model';
import { PROVIDER_LOGGER } from './util';
import { ConsoleLogger } from '@nestjs/common';
import { VectorizerService } from './services/vectorizer.service';
import { MilvusColVectorStore } from './services/vector_store';
import { MilvusCollection } from './services/milvus/milvuscollection.service';

describe('AppController', () => {
  let appController: AppController;
  const conf = TestUtils.testConf;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
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
          provide: PROVIDER_EMBEDDER,
          useClass: AllMpnetBaseV2_StsService,
        },
        SentenceTransformersService,
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
          provide: VectorizerService,
          useFactory: (tbc: TextbaseClient, embedder: ContentEmbedder , vecstore: MilvusColVectorStore ) => {
            return new VectorizerService(tbc, embedder, vecstore);
          },
          inject: [TextbaseClient, PROVIDER_EMBEDDER, MilvusColVectorStore]
        },
        TextbaseClient
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

    it('controller should be defined', async () => {
      expect(appController).toBeDefined();
    });

    it('parseInt', () => {
      expect(parseInt('abc')).toBe(NaN);
      expect(parseInt(null)).toBe(NaN);
      expect(parseInt(undefined)).toBe(NaN);
      expect(parseInt('123')).toBe(123);
    });
  
  });
