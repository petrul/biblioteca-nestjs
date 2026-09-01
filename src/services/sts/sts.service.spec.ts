
import { Test } from '@nestjs/testing';
import { PROVIDER_CONF, VectorizerConfiguration } from '../../configuration';
import { AllMiniLmL6V2_StsService, AllMpnetBaseV2_StsService, SentenceTransformersService } from './sts.service';

describe('StsService', () => {

    const conf : Partial<VectorizerConfiguration> = {
        sentenceTransformersServer: 'http://mini.local:11200',
    }

    let stsService: SentenceTransformersService;
    let all_mpnet_base_v2: AllMpnetBaseV2_StsService;
    let all_minilm_l6_v2: AllMiniLmL6V2_StsService;

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
                AllMiniLmL6V2_StsService,
            ],
        }).compile();

        stsService = moduleRef.get<SentenceTransformersService>(SentenceTransformersService);
        all_mpnet_base_v2 = moduleRef.get<AllMpnetBaseV2_StsService>(AllMpnetBaseV2_StsService);
        all_minilm_l6_v2 = moduleRef.get<AllMiniLmL6V2_StsService>(AllMiniLmL6V2_StsService);
    });

    it('generic call to embeddings', async () => {
        expect(stsService).toBeDefined();
        expect(conf.sentenceTransformersServer).toBeTruthy();
        
        const names = await stsService.getModelNames();
        // 3 models now served: all-MiniLM-L6-v2, all-mpnet-base-v2, and
        // paraphrase-multilingual-MiniLM-L12-v2 (added to the STS server
        // itself - see ~/work/sentence-transformers-server). This only
        // passes once that server's updated image is actually deployed to
        // mini.local, not just built locally.
        expect(names.length).toEqual(3);
        expect(names).toContain('paraphrase-multilingual-MiniLM-L12-v2');

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

    it('AllMiniLmL6V2_StsService.embeddings() adapts Content the same way AllMpnetBaseV2_StsService does', async () => {
        expect(all_minilm_l6_v2.supportedLanguages).toEqual(['en']);

        const content = [
            { text: 'hello there', url: 'u1', sha256: 's1' },
            { text: 'how are you', url: 'u2', sha256: 's2' },
        ];
        const enriched = await all_minilm_l6_v2.embeddings(content);

        expect(enriched.length).toEqual(2);
        enriched.forEach(it => {
            expect(it.embedding).toBeDefined();
            expect(it.embedding.length).toEqual(384);
        });
        expect(enriched[0].embedding).not.toEqual(enriched[1].embedding);
    });
});
