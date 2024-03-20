import { Test, TestingModule } from '@nestjs/testing';

import { VectorizerService } from './vectorizer.service';
import { TextbaseClient } from './textbase_client.service';
import { AppConfService, VectorizerConfiguration, commonConf } from '../configuration';

describe('VectorizerService', () => {
  
  const conf : Partial<VectorizerConfiguration> = {
    sentenceTransformersServer: commonConf.sentenceTransformersServer,
  }

  let vectServ: VectorizerService;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
        providers: [
          {
            provide: AppConfService,
            useValue: conf
          },
          TextbaseClient,
          VectorizerService
        ],
    }).compile();

    vectServ = app.get<VectorizerService>(VectorizerService);
  });

  describe('vectorizer', () => {
    it('vectorizer should work', () => {
    //   expect(indexer.index).toBe('Hello World!');
        vectServ.vectorize(5)
    });
  });
});
