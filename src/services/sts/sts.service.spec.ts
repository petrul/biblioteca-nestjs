
import { Test } from '@nestjs/testing';
import {  AppConfService, PROVIDER_CONF, VectorizerConfiguration, commonConf } from '../../configuration';
import { AllMpnetBaseV2_StsService, SentenceTransformersService } from './sts.service';

describe('StsService', () => {

    const conf : Partial<VectorizerConfiguration> = {
        sentenceTransformersServer: commonConf.sentenceTransformersServer,
    }

    let stsService: SentenceTransformersService;
    let all_mpnet_base_v2: AllMpnetBaseV2_StsService;

    beforeEach(async () => {
        
        const moduleRef = await Test.createTestingModule({
            imports: [],
            controllers: [],
            providers: [ 
                {
                    provide: PROVIDER_CONF,
                    useValue: conf
                }, 
                SentenceTransformersService,
                AllMpnetBaseV2_StsService,
            ],
        }).compile();

        stsService = moduleRef.get<SentenceTransformersService>(SentenceTransformersService);
        all_mpnet_base_v2 = moduleRef.get<AllMpnetBaseV2_StsService>(AllMpnetBaseV2_StsService);
    });

    it('generic call to embeddings', async () => {
        expect(stsService).toBeDefined();
        expect(conf.sentenceTransformersServer).toBeTruthy();
        
        const names = await stsService.getModelNames();
        expect(names.length).toEqual(2);

        {
            const sentences_1 = [
                "scrieti",
                "ce vreti",
                "dvs"
            ];
            const allmini_vects = await stsService.encode(SentenceTransformersService.NAME_ALL_MINILM_L6_V2, sentences_1);
            expect(allmini_vects.length).toEqual(3);
            allmini_vects.forEach(it => expect(it.length).toEqual(384));

            // again to make sure idempotent
            expect(await stsService.encode(SentenceTransformersService.NAME_ALL_MINILM_L6_V2, sentences_1)).toEqual(allmini_vects);
        }
        

        {
            const sentences_2 = [
                "foaie verde",
                "la 5eme republique vous remercie ce que vous faite pentru ea"
            ];
            const allmpnetv2_vects = await all_mpnet_base_v2.encode(sentences_2);
            expect(allmpnetv2_vects.length).toEqual(2);
            allmpnetv2_vects.forEach(it => expect(it.length).toEqual(768));

            // again to make sure idempotent
            expect(await all_mpnet_base_v2.encode(sentences_2)).toEqual(allmpnetv2_vects);
        }

    });
});
