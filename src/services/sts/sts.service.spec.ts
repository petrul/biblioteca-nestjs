
import { Test } from '@nestjs/testing';
import { AppConfService, TextbaseNestjsConfiguration, commonConf } from '../../configuration';
import { All_mpnet_base_v2_StsService, SentenceTransformersService } from './sts.service';

describe('StsService', () => {
    const conf : Partial<TextbaseNestjsConfiguration> = {
        sentenceTransformersServer: commonConf.sentenceTransformersServer
    }
    let stsService: SentenceTransformersService;
    let all_mpnet_base_v2: All_mpnet_base_v2_StsService;

    beforeEach(async () => {
        
        const moduleRef = await Test.createTestingModule({
            imports: [],
            controllers: [],
            providers: [ 
                {
                    provide: AppConfService,
                    useValue: conf,
                },
                SentenceTransformersService,
                All_mpnet_base_v2_StsService,
            ],
        }).compile();

        stsService = moduleRef.get<SentenceTransformersService>(SentenceTransformersService);
        all_mpnet_base_v2 = moduleRef.get<All_mpnet_base_v2_StsService>(All_mpnet_base_v2_StsService);
    });

    it('generic call to embeddings', async () => {
        expect(stsService).toBeDefined();
        expect(conf.sentenceTransformersServer).toBeTruthy();
        
        const names = await stsService.getModelNames();
        expect(names.length).toEqual(2);

        const allmini_vects = await stsService.encode(SentenceTransformersService.NAME_ALL_MINILM_L6_V2, [
            "scrieti", 
            "ce vreti",
            "dvs"]);
        expect(allmini_vects.length).toEqual(3);
        allmini_vects.forEach(it => expect(it.length).toEqual(384));

        const allmpnetv2_vects = await all_mpnet_base_v2.encode([
            "foaie verde", 
            "la 5eme republique vous remercie ce que vous faite pentru ea"
        ]);
        expect(allmpnetv2_vects.length).toEqual(2);
        allmpnetv2_vects.forEach(it => expect(it.length).toEqual(768));
        
    });
});
