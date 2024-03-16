import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { IndexerService } from './services/indexer.service';
import { TextbaseClient } from './services/textbase_client.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [IndexerService, TextbaseClient],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('controller should work"', async () => {
      await appController.doTheIndexing() ; ///.toBe('Hello World!');
    });
  });
});
