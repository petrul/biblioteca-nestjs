import { Test, TestingModule } from '@nestjs/testing';

import { VectorizerService } from './vectorizer.service';
import { TextbaseClient } from './textbase_client.service';
import { AppConfService, PROVIDER_CONF } from '../configuration';
import { TestUtils } from '../../test/testutils';
import { ContentEmbedder, PROVIDER_EMBEDDER } from '../model/model';
import { AllMpnetBaseV2_StsService, SentenceTransformersService } from './sts/sts.service';

describe('VectorizerService', () => {
  
  const conf = TestUtils.testConf;

  let vectServ: VectorizerService;
  let tbc: TextbaseClient;

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
          TextbaseClient,
          {
            provide: VectorizerService,
            useFactory: (tbc: TextbaseClient, embedder: ContentEmbedder  ) => {
              return new VectorizerService(tbc, embedder, 2000);
            },
            inject: [TextbaseClient, PROVIDER_EMBEDDER]
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

    });
  });
});
