import { QdrantVectorStore } from './vector_store';
import { QdrantCollection } from './qdrant/qdrantcollection.service';
import { TestUtils } from '../../test/testutils';
import { Content } from '../model/model';

/**
 * The qdrant port of the retired vector_store.spec.ts (which exercised
 * MilvusColVectorStore against a live milvus instance that no longer
 * exists - milvus is gone, the store path is qdrant now).
 *
 * Live integration against the shared production Qdrant instance
 * (QDRANT_URL, default zmeu.local:6333) - it only ever creates and drops
 * its own test_* collections.
 *
 * Deliberate departures from the milvus original:
 * - no Test.createTestingModule: the wrapper's only dependency is the
 *   collection instance, DI wiring would add nothing under test;
 * - absolute urls (production always stores those) - Qdrant derives the
 *   opus_path from the URL pathname, which relative urls cannot give;
 * - real sha256 hex digests instead of the milvus suite's 'a-p0' style
 *   shas: Qdrant point IDs must be UUIDs, and the deterministic id is the
 *   sha's first 32 hex chars formatted as one;
 * - no findAll(): findById/count are the read surface, and one raw REST
 *   call fetches the vectors for the url-modification test (findById
 *   never returns vectors).
 *
 * The removeOpus test that used to live here is now an offline spec
 * (vectorizer.remove-opus.spec.ts): the store's removal path is pure
 * delegation to QdrantCollection.deleteByOpusPath, and its
 * sibling-safety is carried by the opus_path derivation and exact-match
 * filter tests (offline) plus the collection-level integration smoke.
 * What remains below only proves Qdrant's own behaviors: idempotent
 * upserts and payload overwrites that keep the vectors.
 */

describe('QdrantVectorStore (live integration)', () => {

    jest.setTimeout(TestUtils.TIMEOUT_TWO_MINUTES);

    const qdrantUrl = process.env.QDRANT_URL || 'http://zmeu.local:6333';
    const DIM = 384;

    let col: QdrantCollection;
    let vectorStore: QdrantVectorStore;

    beforeEach(async () => {
        col = new QdrantCollection('test_' + TestUtils.randomAlphanumeric(), qdrantUrl, DIM);
        await col.createAndLoadIfNotExists();
        vectorStore = new QdrantVectorStore(col);
    });

    afterEach(async () => {
        try {
            await col.drop();
        } catch (e) {
            // the test failed before the collection existed - nothing to clean
        }
    });

    it('basic store', async () => {
        expect(vectorStore).toBeDefined();
        expect(col).toBeDefined();
        expect(col).toBe(vectorStore.collection);

        const nrElems = 10;
        const content = TestUtils.randomContent(nrElems);
        expect(content.length).toBeGreaterThan(0);

        await vectorStore.store(content);

        await vectorStore.store(content); // again - idempotent, no duplicates

        expect(await col.count()).toEqual(nrElems);
        const stored = await col.findById(content.map(it => it.sha256));
        expect(stored.map(it => it.sha256).sort()).toEqual(content.map(it => it.sha256).sort());
    },
    TestUtils.TIMEOUT_TWO_MINUTES);

    it('modify url', async () => {
        const nrElems = 10;
        const content = TestUtils.randomContent(nrElems);
        content.forEach((it) => { expect(it.sha256).toBeTruthy(); });
        content.forEach((it) => { expect(it.url).toBeTruthy(); });
        content.forEach((it) => { expect(it.embedding).toBeTruthy(); });

        let originalUrls: string[];

        {
            // 1
            await vectorStore.store(content);

            const stored = await col.findById(content.map(it => it.sha256));
            originalUrls = stored.map(it => it.url);
            originalUrls.forEach((it) => { expect(it).toBeTruthy(); });
            expect(new Set(originalUrls)).toEqual(new Set(content.map(it => it.url)));
            expect(stored.length).toEqual(nrElems);
        }

        {
            // 2 - same shas under new urls: the upsert overwrites each
            // point's payload, it never appends duplicates.
            const contentWithChangedUrls: Content[] = content.map((it, idx) => { return {
                sha256: it.sha256,
                url: `http://server:8080/renamed/p${idx}`, // changed the initial random value
                embedding: it.embedding,
                text: null,
            }});
            await vectorStore.store(contentWithChangedUrls);

            expect(await col.count()).toEqual(nrElems);

            const stored = await col.findById(content.map(it => it.sha256));
            const newUrls: string[] = stored.map(it => it.url);
            newUrls.forEach(it => {
                expect(it).toBeTruthy();
                expect(it.startsWith('http://server:8080/renamed/')).toBeTruthy();
            });
            expect(new Set(originalUrls)).not.toEqual(new Set(newUrls));

            // the vectors survived the payload overwrite - findById never
            // returns them, so ask the REST surface directly.
            const resp = await fetch(`${qdrantUrl}/collections/${col.name}/points`, {
                method: 'post',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    ids: content.map(it => it.sha256).map(QdrantCollection.pointIdOf),
                    with_vector: true,
                    with_payload: false,
                }),
            });
            const points = (await resp.json())?.result ?? [];
            expect(points.length).toEqual(nrElems);
            points.forEach((point: any) => {
                expect(point.vector?.[QdrantCollection.EMBEDDING]?.length).toEqual(DIM);
            });
        }
    },
    TestUtils.TIMEOUT_TWO_MINUTES);
});
