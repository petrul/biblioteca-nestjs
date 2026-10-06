import { VectorizerService } from './vectorizer.service';
import { BibliotecaClient } from './biblioteca_client.service';
import { FakeBibliotecaClient } from '../../test/fake-biblioteca-client';
import { QdrantVectorStore } from './vector_store';
import { QdrantCollection } from './qdrant/qdrantcollection.service';
import { AllMiniLmL6V2_StsService, SentenceTransformersService } from './sts/sts.service';
import { SharedTextbaseConfig } from '../configuration';
import { TestUtils } from '../../test/testutils';
import { LoggerService } from '@nestjs/common';

/**
 * The qdrant port of the retired vectorizer.service.spec.ts (which
 * vectorized into a real MilvusCollection on a live milvus instance that
 * no longer exists - milvus is gone, the store path is qdrant now).
 *
 * End-to-end through the REAL pieces: the live all-MiniLM-L6-v2
 * sentence-transformers server (STS_SERVER, default mini.local:11200),
 * the live shared Qdrant (QDRANT_URL, default zmeu.local:6333) and the
 * real VectorizerService - only biblioteca-server is faked
 * (FakeBibliotecaClient, offline fixtures). It only ever creates and
 * drops its own test_* collections.
 *
 * Deliberate departures from the milvus original:
 * - no Test.createTestingModule: the service's dependencies are
 *   constructed directly, DI wiring would add nothing under test;
 * - the French-skip test is NOT ported as a standalone test - the
 *   language filter itself has a dedicated offline spec
 *   (vectorizer_language_filter.spec.ts, which also covers the
 *   undetected-language case). Here the same property is asserted as part
 *   of the end-to-end run: only the english_fixture paragraphs may ever
 *   reach the store;
 * - absolute urls (production always stores those) - Qdrant derives the
 *   opus_path from the URL pathname, which relative urls cannot give;
 * - real sha256 hex digests instead of the milvus suite's 'a-p0' style
 *   shas: Qdrant point IDs must be UUIDs, and the deterministic id is the
 *   sha's first 32 hex chars formatted as one.
 *
 * The retired suite's removeOpus test is now an offline spec instead
 * (vectorizer.remove-opus.spec.ts): the service path is pure delegation to
 * the store, only the live Qdrant filter behavior needed a real instance -
 * and that is already covered by the collection-level integration smokes.
 * What remains below is the one thing only this suite can prove: the
 * end-to-end wiring of a real embedder's output into a real collection.
 */

describe('VectorizerService (live integration)', () => {

    jest.setTimeout(TestUtils.TIMEOUT_TWO_MINUTES);

    const qdrantUrl = process.env.QDRANT_URL || 'http://zmeu.local:6333';
    const stsServer = process.env.STS_SERVER || 'http://mini.local:11200';

    const shared = {
        kafka: { newOpusImportedTopic: 'test-opus-new', opusReimportedTopic: 'test-opus-reimported', opusRemovedTopic: 'test-opus-removed' },
        milvus: { collection: 'test-collection' },
        embedder: { model: 'TEST', dimension: 3 },
        paragraph: { minChars: 20, maxChars: 3000 },
    } as unknown as SharedTextbaseConfig;

    const log: LoggerService = { log: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined, fatal: () => undefined, verbose: () => undefined };

    let vectServ: VectorizerService;
    let tbc: FakeBibliotecaClient;
    let col: QdrantCollection;
    let vecstore: QdrantVectorStore;

    beforeEach(async () => {
        col = new QdrantCollection('test_' + TestUtils.randomAlphanumeric(), qdrantUrl, 384);
        await col.createAndLoadIfNotExists();
        vecstore = new QdrantVectorStore(col);

        tbc = new FakeBibliotecaClient();
        const sts = new SentenceTransformersService({ sentenceTransformersServer: stsServer } as any);
        const embedder = new AllMiniLmL6V2_StsService(sts);
        vectServ = new VectorizerService(tbc as unknown as BibliotecaClient, embedder, vecstore, shared);
    });

    afterEach(async () => {
        try {
            await col.drop();
        } catch (e) {
            // the test failed before the collection existed - nothing to clean
        }
    });

    it('vectorizes end-to-end: the live embedder + qdrant store behind the real service', async () => {
        const op = await tbc.getElemByPath('/stoker/the_snake_s_pass');
        expect(op.path).toEqual('stoker/the_snake_s_pass');

        let interPageWasCalled = false;
        const maxElems = 20;
        const nrElems = await vectServ.vectorize(op.id,
            () => {
                interPageWasCalled = true;
                return Promise.resolve();
            },
            0, maxElems);

        // FakeBibliotecaClient yields 3 synthetic English paragraphs
        // followed by real French ones (Durkheim); the live
        // all-MiniLM-L6-v2 embedder is English-only, so exactly the
        // English ones are processed - the French ones are actively
        // filtered out by language, not just never reached (the
        // standalone French-skip test of the retired spec, folded here:
        // its filter logic has a dedicated offline spec).
        expect(nrElems).toEqual(3);
        expect(interPageWasCalled).toBeTruthy();

        // exactly the 3 english_fixture rows are in the store - the
        // French ones were filtered out before ever reaching qdrant.
        // (No findAll() on QdrantCollection: scroll the REST surface
        // directly - the same read the retired spec's findAll did.)
        expect(await col.count()).toEqual(3);
        const resp = await fetch(`${qdrantUrl}/collections/${col.name}/points/scroll`, {
            method: 'post',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ limit: 10, with_payload: true, with_vector: false }),
        });
        const rows = ((await resp.json())?.result?.points ?? []).map((p: any) => p.payload);
        expect(rows.length).toEqual(3);
        rows.forEach((payload: any) => {
            expect(payload[QdrantCollection.URL]).toContain('english_fixture');
            expect(payload[QdrantCollection.OPUS_PATH]).toEqual('fake/english_fixture');
        });
    },
    TestUtils.TIMEOUT_TWO_MINUTES);
});
