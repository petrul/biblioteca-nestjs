/// <reference types="jest" />
import { QdrantCollection } from './qdrantcollection.service';
import { Content } from '../../model/model';

/**
 * Offline unit counterpart of qdrantcollection.integration.spec.ts: every
 * property here is biblioteca-nestjs logic living in QdrantCollection
 * itself, verified against a mocked fetch - no live Qdrant, runs anywhere.
 * What is deliberately NOT here: the behaviors only a real Qdrant can
 * prove (upsert idempotency, payload overwrite keeping vectors, a filter
 * engine actually honoring the exact-match delete) stay in the live
 * integration smoke.
 *
 * The port of the retired milvus suite's semantics: sibling-prefix delete
 * safety, dedup-by-sha256, the empty-batch no-op and the dimension check
 * were born as regressions in this code (or its milvus ancestor), so they
 * are guarded offline, not only against a shared live instance.
 */

const DIM = 384;
const URL_QDRANT = 'http://qdrant-mock:6333';

function content(sha256: string, url: string): Content {
    return { sha256, url, embedding: Array.from({ length: DIM }, (_, i) => i), text: null };
}

function okJson(body: any, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

// Every request QdrantCollection issued, in order - the assertion surface
// for "what did our wrapper actually ask the store to do".
let requests: { method: string; path: string; body?: any }[];
let fetchMock: jest.SpyInstance;

/** Points a findById answers with, as Qdrant returns them ({ id, payload }). */
function storedPoints(items: { sha256: string; url: string }[]) {
    return {
        result: items.map(it => ({
            id: QdrantCollection.pointIdOf(it.sha256),
            payload: {
                [QdrantCollection.SHA256]: it.sha256,
                [QdrantCollection.URL]: it.url,
                [QdrantCollection.OPUS_PATH]: QdrantCollection.opusPathOf(it.url),
            },
        })),
    };
}

/**
 * Override that still records requests (unlike a bare mockImplementation
 * replacement): every call lands in `requests` AND answers as a Qdrant
 * holding exactly the given { sha256, url } rows.
 */
function respondWithStored(items: { sha256: string; url: string }[]) {
    fetchMock.mockImplementation(async (input: any, init: any) => {
        const url = new URL(input.toString());
        requests.push({ method: init?.method, path: url.pathname + url.search, body: init?.body ? JSON.parse(init.body) : undefined });
        return okJson(storedPoints(items));
    });
}

beforeEach(() => {
    requests = [];
    fetchMock = jest.spyOn(global, 'fetch' as any).mockImplementation(async (input: any, init: any) => {
        const url = new URL(input.toString());
        requests.push({ method: init?.method, path: url.pathname + url.search, body: init?.body ? JSON.parse(init.body) : undefined });
        return okJson({});
    });
});

afterEach(() => {
    fetchMock.mockRestore();
});

describe('QdrantCollection.pointIdOf', () => {

    it('formats the first 32 hex chars of the sha256 as a UUID', () => {
        const sha = '0123456789abcdef'.repeat(4); // 64 hex chars
        expect(QdrantCollection.pointIdOf(sha)).toEqual('01234567-89ab-cdef-0123-456789abcdef');
    });
});

describe('QdrantCollection.opusPathOf', () => {

    it('derives author/opus from the url pathname', () => {
        expect(QdrantCollection.opusPathOf('https://biblioteca.scriptorium.ro/seneca/de-vita/chapter-1/p-1'))
            .toEqual('seneca/de-vita');
    });

    it('is host-agnostic: same opus path from any host the paragraphs were fetched through', () => {
        // Production stores absolute urls whose host depends on who fetched
        // the paragraphs - the opus identity is the pathname only.
        expect(QdrantCollection.opusPathOf('http://server:8080/seneca/de-vita/p0'))
            .toEqual(QdrantCollection.opusPathOf('https://biblioteca.scriptorium.ro/seneca/de-vita/p0'));
    });

    it('never confuses an opus with its longer sibling', () => {
        // The exact-match delete's safety premise: de-vita-longa is a
        // string-prefix sibling of de-vita, but derives a different path.
        expect(QdrantCollection.opusPathOf('https://biblioteca.scriptorium.ro/seneca/de-vita-longa/p0'))
            .toEqual('seneca/de-vita-longa');
        expect(QdrantCollection.opusPathOf('https://biblioteca.scriptorium.ro/seneca/de-vita-longa/p0'))
            .not.toEqual(QdrantCollection.opusPathOf('https://biblioteca.scriptorium.ro/seneca/de-vita/p0'));
    });

    it('returns an empty string for anything that is not a parseable url', () => {
        expect(QdrantCollection.opusPathOf('not a url')).toEqual('');
        expect(QdrantCollection.opusPathOf('')).toEqual('');
    });
});

describe('QdrantCollection (offline, mocked fetch)', () => {

    let col: QdrantCollection;

    beforeEach(() => {
        col = new QdrantCollection('test_offline', URL_QDRANT, DIM);
    });

    it('upsert dedups a batch carrying duplicate sha256 primary keys before sending it', async () => {
        const a = content('sha-a', 'https://x.scriptorium.ro/seneca/de-vita/p0');
        const repeated = { ...a, url: 'https://x.scriptorium.ro/seneca/de-vita/title' };
        const data = [a, content('sha-b', 'https://x.scriptorium.ro/seneca/de-vita/p1'), repeated];

        await col.upsert(data);

        expect(requests.length).toEqual(1);
        const points = requests[0].body.points;
        expect(points.length).toEqual(2); // one row per sha256, not 3
        expect(points.map((it: any) => it.id).sort())
            .toEqual([QdrantCollection.pointIdOf('sha-a'), QdrantCollection.pointIdOf('sha-b')].sort());
        // last occurrence wins, and carries the derived opus_path payload
        const aPoint = points.find((it: any) => it.payload.sha256 === 'sha-a');
        expect(aPoint.payload[QdrantCollection.OPUS_PATH]).toEqual('seneca/de-vita');
        expect(aPoint.payload[QdrantCollection.URL]).toEqual(repeated.url);
    });

    it('upsert of an empty batch is a clean no-op - no request at all', async () => {
        // The retired milvus error path: an empty upsert used to throw, the
        // Kafka listener treated it as retryable and wedged the consumer on
        // the same event forever. Here it must not even talk to the store.
        expect(await col.upsert([])).toEqual(QdrantCollection.NOOP_MUTATION_RESULT);
        expect(requests.length).toEqual(0);
    });

    it('newOrModified: unchanged rows are filtered out, url changes and new shas pass', async () => {
        const data = [
            content('sha-a', 'https://x.scriptorium.ro/seneca/de-vita/p0'),
            content('sha-b', 'https://x.scriptorium.ro/seneca/de-vita/p1'), // renamed
            content('sha-c', 'https://x.scriptorium.ro/seneca/de-vita/p2'), // entirely new
        ];
        respondWithStored([
            { sha256: 'sha-a', url: 'https://x.scriptorium.ro/seneca/de-vita/p0' },
            { sha256: 'sha-b', url: 'https://x.scriptorium.ro/seneca/de-vita-renamed/p1' },
        ]);

        const newOrModified = await col.newOrModified(data);
        expect(newOrModified.map(it => it.sha256)).toEqual(['sha-b', 'sha-c']);
    });

    it('upsertNewOrModified is a no-op when nothing is new or modified', async () => {
        const data = [
            content('sha-a', 'https://x.scriptorium.ro/seneca/de-vita/p0'),
            content('sha-b', 'https://x.scriptorium.ro/seneca/de-vita/p1'),
        ];
        respondWithStored([
            { sha256: 'sha-a', url: 'https://x.scriptorium.ro/seneca/de-vita/p0' },
            { sha256: 'sha-b', url: 'https://x.scriptorium.ro/seneca/de-vita/p1' },
        ]);

        expect(await col.upsertNewOrModified(data)).toEqual(QdrantCollection.NOOP_MUTATION_RESULT);
        // only the findById POST happened - no upsert PUT was issued
        expect(requests.length).toEqual(1);
        expect(requests[0].method).toEqual('POST');
        expect(requests[0].path).not.toContain('delete');
    });

    it('upsertNewOrModified upserts only the new-or-modified subset', async () => {
        const data = [
            content('sha-a', 'https://x.scriptorium.ro/seneca/de-vita/p0'),
            content('sha-b', 'https://x.scriptorium.ro/seneca/de-vita/p1'), // renamed
            content('sha-c', 'https://x.scriptorium.ro/seneca/de-vita/p2'), // new
        ];
        respondWithStored([
            { sha256: 'sha-a', url: 'https://x.scriptorium.ro/seneca/de-vita/p0' },
            { sha256: 'sha-b', url: 'https://x.scriptorium.ro/seneca/de-vita-renamed/p1' },
        ]);

        await col.upsertNewOrModified(data);

        const put = requests.find(it => it.method === 'PUT');
        expect(put).toBeDefined();
        expect(put.body.points.map((it: any) => it.payload.sha256)).toEqual(['sha-b', 'sha-c']);
    });

    it('deleteByOpusPath issues an exact-match filter on the derived opus_path', async () => {
        await col.deleteByOpusPath('seneca/de-vita');

        expect(requests.length).toEqual(1);
        expect(requests[0].method).toEqual('POST');
        expect(requests[0].path).toEqual(`/collections/test_offline/points/delete?wait=true`);
        // exact match - never a prefix/LIKE pattern, so a 'seneca/de-vita-longa'
        // sibling can never be caught by the de-vita deletion
        expect(requests[0].body).toEqual({
            filter: { must: [{ key: QdrantCollection.OPUS_PATH, match: { value: 'seneca/de-vita' } }] },
        });
    });

    it('deleteByOpusPath refuses an empty path without talking to the store', async () => {
        await expect(col.deleteByOpusPath('  ')).rejects.toThrow(/empty opus path/);
        expect(requests.length).toEqual(0);
    });

    it('assertVectorDimensionMatches resolves on match and throws on mismatch', async () => {
        fetchMock.mockImplementation(async () => okJson({
            result: { config: { params: { vectors: { [QdrantCollection.EMBEDDING]: { size: DIM } } } } },
        }));
        await expect(col.assertVectorDimensionMatches(DIM)).resolves.toBeUndefined();

        fetchMock.mockImplementation(async () => okJson({
            result: { config: { params: { vectors: { [QdrantCollection.EMBEDDING]: { size: DIM * 2 } } } } },
        }));
        await expect(col.assertVectorDimensionMatches(DIM)).rejects.toThrow(/vector dimension/);
    });
});
