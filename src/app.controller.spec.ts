import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { VectorizerService } from './services/vectorizer.service';
import { TextbaseClient } from './services/textbase_client.service';
import { TestUtils } from '../test/testutils';
import { PROVIDER_CONF } from './configuration';
import { AllMpnetBaseV2_StsService, SentenceTransformersService } from './services/sts/sts.service';
import { PROVIDER_EMBEDDER } from './model/model';

describe('AppController', () => {
  let appController: AppController;
  const conf = TestUtils.testConf;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: PROVIDER_CONF,
          useValue: conf 
        },
        {
          provide: PROVIDER_EMBEDDER,
          useClass: AllMpnetBaseV2_StsService,
        },
        SentenceTransformersService,
        // VectorizerService, 
        TextbaseClient
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('controller should work', async () => {
      await appController.doTheVectorizing() ; ///.toBe('Hello World!');
    });
  });
});
