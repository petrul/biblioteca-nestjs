import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { VectorizerService } from './services/vectorizer.service';
import { TextbaseClient } from './services/textbase_client.service';
import { TestUtils } from '../test/testutils';
import { AppConfService } from './configuration';

describe('AppController', () => {
  let appController: AppController;
  const conf = TestUtils.testConf;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppConfService,
          useValue: conf 
        },
        VectorizerService, 
        TextbaseClient],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('controller should work', async () => {
      await appController.doTheVectorizing() ; ///.toBe('Hello World!');
    });
  });
});
