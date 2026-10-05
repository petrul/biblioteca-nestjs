import { QdrantCollection } from './qdrantcollection.service';
import { TestUtils } from '../../../test/testutils';

/**
 * The qdrant port of the retired milvuscollection.service.spec.ts (milvus
 * is gone; the store path is qdrant now - see qdrantcollection.service.ts).
 * Live integration against the shared production Qdrant instance
 * (QDRANT_URL, default zmeu.local:6333) - it only ever creates and drops
 * its own test_* collections, never the live biblioteca_paragraphs_bge_m3.
 *
 * Deliberate departures from the milvus original:
 * - no waitForRows polling: Qdrant writes use ?wait=true, so count() is
 *   exact the moment a call returns (Milvus needed flush/load/visibility
 *   waits);
 * - no findAll(): count() + findById() are the read surface this worker
 *   uses, and they cover everything findAll did;
 * - deletes go by the derived opus_path payload (deleteByOpusPath) instead
 *   of Milvus's LIKE url-prefix patterns, so urls must be absolute - which
 *   production always stores anyway;
 * - the milvus "persists useful comments on the collection and every
 *   field" test has no counterpart: Qdrant has no collection/field
 *   description fields (the constructor's description is log-only).
 */

describe('QdrantCollection (live integration)', () => {

    jest.setTimeout(TestUtils.TIMEOUT_TWO_MINUTES);

    const qdrantUrl = process.env.QDRANT_URL || 'http://zmeu.local:6333';
    // Same dimension the milvus suites used - the sha256/url/opus_path
    // semantics under test don't depend on it.
    const DIM = 384;

    let col: QdrantCollection;

    beforeEach(async () => {
        col = new QdrantCollection('test_' + TestUtils.randomAlphanumeric(), qdrantUrl, DIM);
        expect(await col.exists()).toBe(false);
        await col.createAndLoadIfNotExists();
        expect(await col.exists()).toBe(true);
    });

    afterEach(async () => {
        // Plain REST, nothing to close: dropping is all the cleanup there is.
        try {
            await col.drop();
        } catch (e) {
            // the test failed before the collection existed - nothing to clean
        }
    });

    it('upserts data idempotently, and newOrModified/upsertNewOrModified track url changes', async () => {
        const data = TestUtils.randomContent(10, DIM, 200);

        const firstHalf = data.slice(0, 5);
        expect(firstHalf.length).toBe(5);

        await col.upsert(firstHalf);
        expect(await col.count()).toEqual(5);

        const inShas = firstHalf.map(it => it.sha256);
        const alreadyPresent = (await col.findById(inShas)).map(it => it.sha256);
        expect(alreadyPresent.length).toBe(5);
        expect(alreadyPresent.sort()).toEqual(inShas.sort());

        // again - upsert is idempotent, the count does not double
        await col.upsert(firstHalf);
        expect(await col.count()).toEqual(5);

        // now upsert all 10, there should be a total of ten
        await col.upsert(data);
        expect(await col.count()).toEqual(10);

        {
            // two updated records
            data[0].url = 'https://textbase.scriptorium.ro/' + TestUtils.randomAlphanumeric();
            data[3].url = 'https://textbase.scriptorium.ro/' + TestUtils.randomAlphanumeric();
            const newOrModified = await col.newOrModified(data);
            expect(newOrModified.length).toEqual(2);

            data.push(...TestUtils.randomContent(1, DIM, 200)); // new element altogether
            expect(data.length).toBe(11);
            expect((await col.newOrModified(data)).length).toBe(3);

            await col.upsertNewOrModified(data);
            expect(await col.count()).toEqual(11);
        }
    }, TestUtils.TIMEOUT_TWO_MINUTES);

    it('deletes one opus without deleting a similarly-prefixed sibling', async () => {
        const data = TestUtils.randomContent(4, DIM, 200);
        data[0].url = 'https://biblioteca.scriptorium.ro/seneca/de-vita';
        data[1].url = 'https://biblioteca.scriptorium.ro/seneca/de-vita/chapter-1/p-1';
        data[2].url = 'https://biblioteca.scriptorium.ro/seneca/de-vita/chapter-2/p-1';
        data[3].url = 'https://biblioteca.scriptorium.ro/seneca/de-vita-longa/chapter-1/p-1';
        await col.upsert(data);
        expect(await col.count()).toEqual(4);

        await col.deleteByOpusPath('seneca/de-vita');

        expect(await col.count()).toEqual(1);
        const remaining = await col.findById([data[3].sha256]);
        expect(remaining).toHaveLength(1);
        expect(remaining[0].url).toEqual('https://biblioteca.scriptorium.ro/seneca/de-vita-longa/chapter-1/p-1');
    }, TestUtils.TIMEOUT_TWO_MINUTES);

    it('deletes one opus stored with host-prefixed urls, without touching a sibling', async () => {
        // Production stores absolute urls whose host depends on who fetched
        // the paragraphs (internal http://server:8080/... here, the public
        // host for anything vectorized via an external request). The
        // opus_path is derived from the pathname only, so the deletion is
        // host-agnostic.
        const data = TestUtils.randomContent(4, DIM, 200);
        data[0].url = 'http://server:8080/seneca/de-vita';
        data[1].url = 'http://server:8080/seneca/de-vita/chapter-1/p-1';
        data[2].url = 'https://biblioteca.scriptorium.ro/seneca/de-vita/chapter-2/p-1';
        data[3].url = 'http://server:8080/seneca/de-vita-longa/chapter-1/p-1';
        await col.upsert(data);
        expect(await col.count()).toEqual(4);

        await col.deleteByOpusPath('seneca/de-vita');

        expect(await col.count()).toEqual(1);
        const remaining = await col.findById([data[3].sha256]);
        expect(remaining).toHaveLength(1);
        expect(remaining[0].url).toEqual('http://server:8080/seneca/de-vita-longa/chapter-1/p-1');
    }, TestUtils.TIMEOUT_TWO_MINUTES);

    it('upsertNewOrModified is a no-op, not an error, when nothing is new or modified', async () => {
        // A page whose every paragraph is already stored unchanged used to
        // end in milvus.upsert([]) -> "fields_data should be an array and
        // length > 0", which the Kafka listener treats as a retryable
        // error, wedging the consumer on the same event forever. Qdrant's
        // empty upsert must be a clean no-op instead.
        const data = TestUtils.randomContent(5, DIM, 200);
        await col.upsert(data);
        expect(await col.count()).toEqual(5);

        const resp = await col.upsertNewOrModified(data);
        expect(resp).toEqual(QdrantCollection.NOOP_MUTATION_RESULT);
        expect(await col.count()).toEqual(5);
    }, TestUtils.TIMEOUT_TWO_MINUTES);

    it('upsert persists a batch containing duplicate sha256 primary keys', async () => {
        // The same text appearing twice in one batch (e.g. a repeated opus
        // title) carries duplicate point IDs, and one point ID must occur
        // only once per upsert - the batch is deduplicated to one row per
        // sha256 before being sent.
        const data = TestUtils.randomContent(5, DIM, 200);
        const repeated = { ...data[1] };
        repeated.url = 'https://textbase.scriptorium.ro/' + TestUtils.randomAlphanumeric();
        data.push(repeated);

        await col.upsert(data);
        expect(await col.count()).toEqual(5);
        expect((await col.findById(data.map(it => it.sha256))).length).toEqual(5);
    }, TestUtils.TIMEOUT_TWO_MINUTES);

    it('assertVectorDimensionMatches resolves on match and throws on mismatch', async () => {
        await expect(col.assertVectorDimensionMatches(DIM)).resolves.toBeUndefined();
        await expect(col.assertVectorDimensionMatches(DIM * 2)).rejects.toThrow(/vector dimension/);
    }, TestUtils.TIMEOUT_TWO_MINUTES);
});
