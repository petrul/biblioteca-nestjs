
import { Test } from '@nestjs/testing';
import { PROVIDER_CONF, VectorizerConfiguration } from '../../configuration';
import { AllMiniLmL6V2_StsService, AllMpnetBaseV2_StsService, SentenceTransformersService } from './sts.service';
import { BgeM3OllamaService, OllamaService } from '../ollama/ollama.service';

// Real-network tests, gated off by default like the Ollama ones (see
// ollama.service.spec.ts) - never run unattended in CI.
const describeOllama = process.env.RUN_OLLAMA_INTEGRATION === 'true' ? describe : describe.skip;

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

    // Disabled: mini.local:11200 still only serves 2 models - the 3-model
    // image (all-MiniLM-L6-v2, all-mpnet-base-v2, paraphrase-multilingual-
    // MiniLM-L12-v2 - see ~/work/sentence-transformers-server) was built but
    // deliberately never published/deployed there. STS is also no longer
    // the active production embedder (BGE-M3 via Ollama is - see
    // "active embedding service" below), so this is blocked on an infra
    // deploy that no longer gates anything real. Re-enable once that image
    // is actually deployed, if STS gets used for something again.
    it.skip('generic call to embeddings', async () => {
        expect(stsService).toBeDefined();
        expect(conf.sentenceTransformersServer).toBeTruthy();

        const names = await stsService.getModelNames();
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

// Replaces the disabled STS model-count test above as the "is the
// production embedder actually up" check - BGE-M3 via zmeu's Ollama is
// PROVIDER_EMBEDDER now (see app.module.ts), not STS.
describeOllama('active embedding service (bge-m3 via zmeu Ollama)', () => {

    const conf: Partial<VectorizerConfiguration> = {
        ollamaServer: 'http://zmeu.local:11434',
    };

    let bgeM3: BgeM3OllamaService;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                { provide: PROVIDER_CONF, useValue: conf },
                OllamaService,
                BgeM3OllamaService,
            ],
        }).compile();

        bgeM3 = moduleRef.get<BgeM3OllamaService>(BgeM3OllamaService);
    });

    it('is available and returns a correctly-shaped embedding', async () => {
        const vectors = await bgeM3.encode(['is the embedding service up?']);
        expect(vectors.length).toEqual(1);
        expect(vectors[0].length).toEqual(1024);
    });
});
