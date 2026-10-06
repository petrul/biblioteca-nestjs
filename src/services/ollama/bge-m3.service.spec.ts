import { Test } from '@nestjs/testing';
import { PROVIDER_CONF, VectorizerConfiguration } from '../../configuration';
import { BgeM3OllamaService, OllamaService } from './ollama.service';
import { TestUtils } from '../../../test/testutils';

// The bge-m3 migration of the retired StsService suite, moved out of sts/
// along with its subject: nothing here touches STS, the embedder under
// test is Ollama-backed. STS (the
// sentence-transformers server on mini.local:11200) is no longer the
// production embedder - BGE-M3 via zmeu's Ollama is PROVIDER_EMBEDDER now
// (see app.module.ts) - and the old suite's centerpiece (the "generic
// call to embeddings" test) was skipped for good: mini's STS server serves
// only 2 of the 3 models it asserted, and the 3-model image was built but
// deliberately never deployed. Rather than wait on that deploy, the tests
// migrated here to the embedder that actually gates production:
// - model inventory + multilingual encode + idempotency (the generic call
//   test; its Romanian sentences finally get embedded by a model that
//   actually speaks Romanian - the English-only MiniLM never honestly
//   could),
// - the Content adaptation check (BgeM3OllamaService.embeddings() does
//   what AllMiniLmL6V2_StsService.embeddings() used to),
// - the "is the production embedder up" availability check.
//
// Live tests, no gates: they run in every suite, and the two-minute
// per-test timeouts absorb a busy shared host.
describe('BgeM3OllamaService - the active embedder (migrated from the retired StsService suite)', () => {

    const conf: Partial<VectorizerConfiguration> = {
        ollamaUrl: 'http://zmeu.local:11434',
    };

    let bgeM3: BgeM3OllamaService;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [],
            controllers: [],
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
    }, TestUtils.TIMEOUT_TWO_MINUTES);

    it('generic call to embeddings: the shared host serves bge-m3, which encodes multilingual text deterministically', async () => {
        // Model inventory - the part the old STS server could never
        // satisfy (2 of 3 models). OllamaService exposes no tags call,
        // so the inventory check goes to the raw REST surface.
        const tags = await (await fetch(`${conf.ollamaUrl}/api/tags`)).json();
        const names = (tags?.models ?? []).map((it: any) => it.name);
        expect(names).toContain('bge-m3:latest');

        const sentences = ['scrieti', 'ce vreti', 'foaie verde'];
        const vects = await bgeM3.encode(sentences);
        expect(vects.length).toEqual(3);
        vects.forEach(it => expect(it.length).toEqual(1024));

        // again to make sure idempotent - the property the old test pinned
        expect(await bgeM3.encode(sentences)).toEqual(vects);
    }, TestUtils.TIMEOUT_TWO_MINUTES);

    it('embeddings() adapts Content the way the STS encoders used to: vectors attached in place, correctly shaped and distinct', async () => {
        // bge-m3 is multilingual where the English-only MiniLM it replaces
        // was not - the language-aware embedding filter treats it as 'all'.
        expect(bgeM3.supportedLanguages).toBe('all');

        const content = [
            { text: 'hello there', url: 'u1', sha256: 's1' },
            { text: 'how are you', url: 'u2', sha256: 's2' },
        ];
        const enriched = await bgeM3.embeddings(content);

        expect(enriched.length).toEqual(2);
        enriched.forEach(it => {
            expect(it.embedding).toBeDefined();
            expect(it.embedding.length).toEqual(1024);
        });
        expect(enriched[0].embedding).not.toEqual(enriched[1].embedding);
    }, TestUtils.TIMEOUT_TWO_MINUTES);
});
