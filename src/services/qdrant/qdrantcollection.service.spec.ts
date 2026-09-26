import { QdrantCollection } from './qdrantcollection.service';
import { Content } from '../../model/model';

/**
 * Unit test for QdrantCollection - the write-path Qdrant client behind
 * VECTOR_STORE=qdrant. Fetch is mocked, no Qdrant needed: what's under
 * test is the REST shape it speaks (the same data shape the Milvus
 * collection stores, per the VectorStore contract) and the deterministic
 * id/opus-path derivations that both biblioteca-server and this worker
 * must agree on.
 */
describe('QdrantCollection', () => {

    const sha = (n: number) => `${String(n).padStart(64, '0')}`;

    // Direct assignment rather than jest.spyOn(global, 'fetch'): fetch is
    // a getter on globalThis in modern Node, and a getter-spy's
    // mockImplementation replaces what the GETTER returns, not fetch
    // itself. Assigning a jest.fn (and restoring the original after) is
    // simpler and actually under test control.
    const restores: (() => void)[] = [];
    function mockFetch(responses: { status?: number; ok?: boolean; body?: any }[]) {
        let call = 0;
        const calls: { method: string; url: string; body?: any }[] = [];
        const original = (global as any).fetch;
        (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
            calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(init.body as string) : undefined });
            const r = responses[Math.min(call, responses.length - 1)];
            call++;
            return { ok: r.ok ?? (r.status ?? 200) < 400, status: r.status ?? 200, text: async () => '', json: async () => r.body ?? {} } as any;
        });
        restores.push(() => { (global as any).fetch = original; });
        return calls;
    }

    afterEach(() => { while (restores.length) restores.pop()(); });

    it('derives a deterministic point id from the sha256 - in sync with biblioteca-server', () => {
        const id = QdrantCollection.pointIdOf(sha(1));
        expect(id).toBe('00000000-0000-0000-0000-' + '0'.repeat(12));
        expect(QdrantCollection.pointIdOf(sha(1))).toBe(id);
    });

    it('derives the author/opus path from a stored paragraph URL', () => {
        expect(QdrantCollection.opusPathOf('http://server:8080/bacon/the_essays/of_gardens/_1'))
            .toBe('bacon/the_essays');
        // A similarly-prefixed sibling opus can never collide: the path
        // is exactly two segments.
        expect(QdrantCollection.opusPathOf('http://server:8080/seneca/de-vita-longa/p0'))
            .toBe('seneca/de-vita-longa');
    });

    it('creates the HNSW/Euclid/int8 collection and its keyword payload indexes', async () => {
        const calls = mockFetch([{ body: { result: true } }]);

        const col = new QdrantCollection('test_bge_m3', 'http://qdrant.test:6333', 1024);
        await col.create();

        expect(calls[0].method).toBe('PUT');
        expect(calls[0].url).toBe('http://qdrant.test:6333/collections/test_bge_m3');
        expect(calls[0].body.vectors.embedding).toEqual({ size: 1024, distance: 'Euclid' });
        expect(calls[0].body.hnsw_config).toEqual({ m: 16, ef_construct: 100 });
        expect(calls[0].body.quantization_config).toEqual({ scalar: { type: 'int8', always_ram: true } });

        const indexPuts = calls.filter(it => it.url.endsWith('/index'));
        expect(indexPuts.map(it => it.body.field_name).sort())
            .toEqual(['opus_path', 'sha256', 'url'].sort());
        expect(indexPuts.every(it => it.body.field_schema === 'keyword')).toBe(true);
    });

    it('exists is false on 404 and true on 200, and only throws on real errors', async () => {
        mockFetch([{ status: 404, ok: false }]);
        expect(await new QdrantCollection('x', 'http://q', 3).exists()).toBe(false);

        mockFetch([{ body: { result: {} } }]);
        expect(await new QdrantCollection('x', 'http://q', 3).exists()).toBe(true);

        mockFetch([{ status: 500, ok: false }]);
        await expect(new QdrantCollection('x', 'http://q', 3).exists()).rejects.toThrow();
    });

    it('upserts deduped points carrying sha256, url and the derived opus path', async () => {
        const calls = mockFetch([{ body: { result: {} } }]);

        const col = new QdrantCollection('test_bge_m3', 'http://q', 2);
        const content: Content[] = [
            { sha256: sha(1), url: 'http://s/bacon/the_essays/c1', text: 'gardens', embedding: [0.1, 0.2] },
            // same sha256 again - deduped out, exactly like MilvusCollection.toRows
            { sha256: sha(1), url: 'http://s/bacon/the_essays/c1', text: 'gardens', embedding: [0.1, 0.2] },
            { sha256: sha(2), url: 'http://s/hu/gutenberg/x/c2', text: 'text', embedding: [0.3, 0.4] },
        ];
        await col.upsert(content);

        expect(calls[0].url).toContain('/points?wait=true');
        expect(calls[0].body.points).toHaveLength(2);
        expect(calls[0].body.points[0].vector).toEqual({ embedding: [0.1, 0.2] });
        expect(calls[0].body.points[0].payload.sha256).toBe(sha(1));
        expect(calls[0].body.points[0].payload.opus_path).toBe('bacon/the_essays');
        expect(calls[0].body.points[1].payload.opus_path).toBe('hu/gutenberg');
    });

    it('upsert of an empty batch is a no-op, not an error - same as MilvusCollection', async () => {
        const calls = mockFetch([{ body: { result: {} } }]);
        const col = new QdrantCollection('x', 'http://q', 2);
        await col.upsert([]);
        expect(calls).toHaveLength(0);
    });

    it('newOrModified keeps new hashes and url-changed hashes only', async () => {
        mockFetch([{
            // findById answer: sha(1) stored with the same url, sha(3) stored with a different one
            body: { result: [
                { id: 'x', payload: { sha256: sha(1), url: 'http://s/a/b/c1' } },
                { id: 'y', payload: { sha256: sha(3), url: 'http://s/OLD/url' } },
            ] },
        }]);

        const col = new QdrantCollection('x', 'http://q', 2);
        const content: Content[] = [
            { sha256: sha(1), url: 'http://s/a/b/c1', text: 'c1', embedding: [1, 2] },  // unchanged -> dropped
            { sha256: sha(2), url: 'http://s/c/d/c2', text: 'c2', embedding: [1, 2] },  // new -> kept
            { sha256: sha(3), url: 'http://s/new/url', text: 'c3', embedding: [1, 2] }, // url changed -> kept
        ];
        const kept = await col.newOrModified(content);

        expect(kept.map(it => it.sha256)).toEqual([sha(2), sha(3)]);
    });

    it('removeOpus deletes by an exact opus_path match, never a scan', async () => {
        const calls = mockFetch([{ body: { result: {} } }]);
        const col = new QdrantCollection('x', 'http://q', 2);
        await col.deleteByOpusPath('seneca/de-vita');

        expect(calls[0].url).toContain('/points/delete');
        expect(calls[0].body.filter).toEqual({
            must: [{ key: 'opus_path', match: { value: 'seneca/de-vita' } }],
        });
    });

    it('assertVectorDimensionMatches fails loudly on a stale collection', async () => {
        mockFetch([{
            body: { result: { config: { params: { vectors: { embedding: { size: 384 } } } } } },
        }]);
        const col = new QdrantCollection('x', 'http://q', 1024);
        await expect(col.assertVectorDimensionMatches(1024)).rejects.toThrow(/384.*1024/);
    });
});
