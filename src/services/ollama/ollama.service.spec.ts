
import { Test } from '@nestjs/testing';
import { PROVIDER_CONF, VectorizerConfiguration, commonConf } from '../../configuration';
import { NomicEmbedOllamaService, OllamaService, Qwen3EmbeddingOllamaService } from './ollama.service';
import { TestUtils } from '../../../test/testutils';

describe('OllamaService', () => {

    const conf: Partial<VectorizerConfiguration> = {
        ollamaServer: commonConf.ollamaServer,
    }

    let ollamaService: OllamaService;
    let qwen3: Qwen3EmbeddingOllamaService;
    let nomic: NomicEmbedOllamaService;

    beforeEach(async () => {

        const moduleRef = await Test.createTestingModule({
            imports: [],
            controllers: [],
            providers: [
                {
                    provide: PROVIDER_CONF,
                    useValue: conf
                },
                OllamaService,
                Qwen3EmbeddingOllamaService,
                NomicEmbedOllamaService,
            ],
        }).compile();

        ollamaService = moduleRef.get<OllamaService>(OllamaService);
        qwen3 = moduleRef.get<Qwen3EmbeddingOllamaService>(Qwen3EmbeddingOllamaService);
        nomic = moduleRef.get<NomicEmbedOllamaService>(NomicEmbedOllamaService);
    });

    it('qwen3-embedding produces 2560-dim vectors', async () => {
        expect(conf.ollamaServer).toBeTruthy();

        const sentences = ['foaie verde', 'la 5eme republique vous remercie ce que vous faite pentru ea'];
        const vects = await ollamaService.encode(Qwen3EmbeddingOllamaService.modelName, sentences);
        expect(vects.length).toEqual(2);
        vects.forEach(it => expect(it.length).toEqual(2560));

        // via the wrapper service too, same result shape
        const viaService = await qwen3.encode(sentences);
        expect(viaService.length).toEqual(2);
        viaService.forEach(it => expect(it.length).toEqual(2560));
    }, TestUtils.TIMEOUT_TWO_MINUTES); // a cold-loaded 4B model can take a while for its first call

    it('nomic-embed-text produces 768-dim vectors', async () => {
        const sentences = ['foaie verde', 'how are you'];
        const vects = await nomic.encode(sentences);
        expect(vects.length).toEqual(2);
        vects.forEach(it => expect(it.length).toEqual(768));
    }, TestUtils.TIMEOUT_TWO_MINUTES);

    it('embeddings() adapts Content[] in place, matching AllMpnetBaseV2_StsService\'s contract', async () => {
        const content = TestUtils.randomContent(3, 0, 40);
        content.forEach(it => delete it.embedding);

        const result = await qwen3.embeddings(content);
        expect(result.length).toEqual(3);
        result.forEach(it => {
            expect(it.embedding).toBeDefined();
            expect(it.embedding.length).toEqual(2560);
        });
    }, TestUtils.TIMEOUT_TWO_MINUTES);

    it('qwen3 and nomic produce differently-shaped vectors for the same text', async () => {
        const text = 'foaie verde';
        const [qwenVec] = await qwen3.encode([text]);
        const [nomicVec] = await nomic.encode([text]);
        expect(qwenVec.length).not.toEqual(nomicVec.length);
    }, TestUtils.TIMEOUT_TWO_MINUTES);
});
