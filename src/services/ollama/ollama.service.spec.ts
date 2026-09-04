
import { Test } from '@nestjs/testing';
import { PROVIDER_CONF, VectorizerConfiguration } from '../../configuration';
import { BgeM3OllamaService, NomicEmbedOllamaService, OllamaService, Qwen3EmbeddingOllamaService } from './ollama.service';
import { TestUtils } from '../../../test/testutils';

// These tests call a shared production Ollama host and load large models. Keep
// normal CI deterministic when that host is busy (for example with OCR), while
// retaining an explicit way to run the live integration suite.
const describeOllama = process.env.RUN_OLLAMA_INTEGRATION === 'true' ? describe : describe.skip;

describeOllama('OllamaService', () => {

    const conf: Partial<VectorizerConfiguration> = {
        ollamaServer: 'http://zmeu.local:11434',
    }

    let qwen3: Qwen3EmbeddingOllamaService;
    let nomic: NomicEmbedOllamaService;
    let bgeM3: BgeM3OllamaService;

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
                BgeM3OllamaService,
                Qwen3EmbeddingOllamaService,
                NomicEmbedOllamaService,
            ],
        }).compile();

        qwen3 = moduleRef.get<Qwen3EmbeddingOllamaService>(Qwen3EmbeddingOllamaService);
        nomic = moduleRef.get<NomicEmbedOllamaService>(NomicEmbedOllamaService);
        bgeM3 = moduleRef.get<BgeM3OllamaService>(BgeM3OllamaService);
    });

    it('bge-m3 produces 1024-dim multilingual vectors', async () => {
        const vects = await bgeM3.encode(['foaie verde', '自由与责任']);
        expect(vects.length).toEqual(2);
        vects.forEach(it => expect(it.length).toEqual(1024));
    }, TestUtils.TIMEOUT_TWO_MINUTES);

    it('qwen3-embedding produces 2560-dim vectors', async () => {
        expect(conf.ollamaServer).toBeTruthy();

        const sentences = ['foaie verde', 'la 5eme republique vous remercie ce que vous faite pentru ea'];
        const vects = await qwen3.encode(sentences);
        expect(vects.length).toEqual(2);
        vects.forEach(it => expect(it.length).toEqual(2560));
    }, TestUtils.TIMEOUT_TWO_MINUTES); // a cold-loaded 4B model can take a while for its first call

    it('nomic-embed-text produces 768-dim vectors', async () => {
        const sentences = ['foaie verde', 'how are you'];
        const vects = await nomic.encode(sentences);
        expect(vects.length).toEqual(2);
        vects.forEach(it => expect(it.length).toEqual(768));
    }, TestUtils.TIMEOUT_TWO_MINUTES);

});
