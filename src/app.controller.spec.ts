import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { TextbaseClient } from './services/textbase_client.service';
import { VectorizerService } from './services/vectorizer.service';
import { MilvusCollection } from './services/milvus/milvuscollection.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: TextbaseClient,
          useValue: {},
        },
        {
          provide: VectorizerService,
          useValue: {},
        },
        {
          provide: MilvusCollection,
          useValue: { compact: jest.fn() },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

    it('controller should be defined', async () => {
      expect(appController).toBeDefined();
    });

    it('returns application name and stable version', () => {
      expect(appController.info()).toEqual({
        name: 'textbase-vectorizer',
        version: '0.1.0',
      });
    });

    it('parseInt', () => {
      expect(parseInt('abc')).toBe(NaN);
      expect(parseInt(null)).toBe(NaN);
      expect(parseInt(undefined)).toBe(NaN);
      expect(parseInt('123')).toBe(123);
    });
  
  });
