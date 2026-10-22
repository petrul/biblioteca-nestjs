/// <reference types="jest" />
import { QdrantVectorStore } from './qdrant.vector-store';

/**
 * QdrantVectorStore against a mocked fetch: the REST shape it speaks, and the
 * deterministic point ids biblioteca-server must agree on.
 */
describe('QdrantVectorStore (offline, mocked fetch)', () => {
  // Direct assignment rather than jest.spyOn(global, 'fetch'): fetch is a
  // getter on globalThis in modern Node.
  const restores: (() => void)[] = [];
  function mockFetch(responses: { status?: number; body?: any }[]) {
    let call = 0;
    const calls: { method: string; url: string; body?: any; headers?: any }[] = [];
    const original = (global as any).fetch;
    (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(init.body as string) : undefined, headers: init?.headers });
      const r = responses[Math.min(call++, responses.length - 1)];
      const status = r.status ?? 200;
      return { ok: status < 400, status, text: async () => '', json: async () => r.body ?? {} } as any;
    });
    restores.push(() => { (global as any).fetch = original; });
    return calls;
  }
  afterEach(() => { while (restores.length) restores.pop()!(); });

  const store = (options: Partial<ConstructorParameters<typeof QdrantVectorStore>[0]> = {}) =>
    new QdrantVectorStore({ url: 'http://qdrant.test:6333/', idField: 'sha256', ...options });
  const sha = '0123456789abcdef'.repeat(4);

  it('derives point ids: a sha256 gives its first 32 hex chars as a UUID (as biblioteca-server does), other ids are hashed first', () => {
    expect(QdrantVectorStore.pointIdOf(sha)).toBe('01234567-89ab-cdef-0123-456789abcdef');
    expect(QdrantVectorStore.pointIdOf('0'.repeat(64))).toBe('00000000-0000-0000-0000-000000000000');
    const hashed = QdrantVectorStore.pointIdOf('https://x.test/page#passage-1');
    expect(hashed).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(QdrantVectorStore.pointIdOf('https://x.test/page#passage-1')).toBe(hashed);
  });

  it('converts filters: values match exactly, arrays match any', () => {
    expect(QdrantVectorStore.toQdrantFilter({ opus_path: ['a/b', 'c/d'], lang: 'fr' })).toEqual({
      must: [{ key: 'opus_path', match: { any: ['a/b', 'c/d'] } }, { key: 'lang', match: { value: 'fr' } }],
    });
    expect(QdrantVectorStore.toQdrantFilter({})).toBeUndefined();
  });

  it('creates a missing collection with the spec, the tuning and keyword indexes; leaves an existing one alone', async () => {
    const calls = mockFetch([{ status: 404 }, { body: { result: true } }]);
    await store({ tuning: { hnsw: { m: 16, ef_construct: 100 }, int8Quantization: true } })
      .ensure('test_bge_m3', { dimension: 1024, metric: 'euclid', indexedFields: ['sha256', 'url', 'opus_path'] });
    expect(calls[1]).toMatchObject({ method: 'PUT', url: 'http://qdrant.test:6333/collections/test_bge_m3' });
    expect(calls[1].body).toEqual({
      vectors: { embedding: { size: 1024, distance: 'Euclid' } },
      hnsw_config: { m: 16, ef_construct: 100 },
      quantization_config: { scalar: { type: 'int8', always_ram: true } },
    });
    expect(calls.filter((c) => c.url.endsWith('/index')).map((c) => [c.body.field_name, c.body.field_schema]))
      .toEqual([['sha256', 'keyword'], ['url', 'keyword'], ['opus_path', 'keyword']]);

    const existing = mockFetch([{ body: { result: {} } }]);
    await store().ensure('test_bge_m3', { dimension: 1024, metric: 'euclid' });
    expect(existing).toHaveLength(1);
  });

  it('fails loudly on an incompatible collection', async () => {
    mockFetch([{ body: { result: { config: { params: { vectors: { embedding: { size: 384, distance: 'Euclid' } } } } } } }]);
    await expect(store().assertCompatible('c', { dimension: 1024, metric: 'euclid' })).rejects.toThrow('384-dim Euclid');
    mockFetch([{ body: { result: { config: { params: { vectors: { embedding: { size: 1024, distance: 'Euclid' } } } } } } }]);
    await expect(store().assertCompatible('c', { dimension: 1024, metric: 'euclid' })).resolves.toBeUndefined();
  });

  it('upserts deduped points under the named vector, with the item id in the payload; an empty batch sends nothing', async () => {
    const calls = mockFetch([{ body: {} }]);
    await store().upsert('c', [
      { id: sha, vector: [1], payload: { url: 'old' } },
      { id: sha, vector: [2], payload: { url: 'new' } },
    ]);
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'http://qdrant.test:6333/collections/c/points?wait=true' });
    expect(calls[0].body.points).toEqual([{ id: '01234567-89ab-cdef-0123-456789abcdef', vector: { embedding: [2] }, payload: { url: 'new', sha256: sha } }]);
    await store().upsert('c', []);
    expect(calls).toHaveLength(1);
  });

  it('queries with the filter and reports item ids and the collection metric as score kind', async () => {
    const calls = mockFetch([
      { body: { result: { config: { params: { vectors: { embedding: { size: 3, distance: 'Euclid' } } } } } } },
      { body: { result: { points: [{ id: 'uuid', score: 0.7, payload: { sha256: sha, url: 'u' } }] } } },
    ]);
    const results = await store().query('c', [1, 2, 3], 5, { opus_path: ['a/b'] });
    expect(calls[1].body).toEqual({
      query: [1, 2, 3], using: 'embedding', limit: 5, with_payload: true,
      filter: { must: [{ key: 'opus_path', match: { any: ['a/b'] } }] },
    });
    expect(results).toEqual([{ id: sha, score: 0.7, scoreKind: 'distance', payload: { sha256: sha, url: 'u' } }]);
  });

  it('asks for rescoring on quantized collections: filtered queries would otherwise rank by raw int8 scores', async () => {
    const calls = mockFetch([
      { body: { result: { config: { params: { vectors: { embedding: { size: 3, distance: 'Euclid' } } } } } } },
      { body: { result: { points: [] } } },
    ]);
    await store({ tuning: { int8Quantization: true } }).query('c', [1, 2, 3], 5, { opus_path: 'a/b' });
    expect(calls[1].body.params).toEqual({ quantization: { rescore: true, oversampling: 2 } });
  });

  it('retrieves stored payloads by item id, and overwrites payloads without touching vectors', async () => {
    const calls = mockFetch([{ body: { result: [{ id: 'uuid', payload: { sha256: sha, url: 'u' } }] } }, { body: {} }]);
    expect(await store().retrieve('c', [sha, sha])).toEqual([{ id: sha, payload: { sha256: sha, url: 'u' } }]);
    expect(calls[0].body).toEqual({ ids: ['01234567-89ab-cdef-0123-456789abcdef'], with_payload: true, with_vector: false });

    await store().setPayload('c', [{ id: sha, payload: { url: 'moved' } }]);
    expect(calls[1]).toMatchObject({ method: 'POST', url: 'http://qdrant.test:6333/collections/c/points/batch?wait=true' });
    expect(calls[1].body.operations).toEqual([{ overwrite_payload: { points: ['01234567-89ab-cdef-0123-456789abcdef'], payload: { url: 'moved', sha256: sha } } }]);
  });

  it('deletes by filter, refusing an empty one without a request', async () => {
    const calls = mockFetch([{ body: {} }]);
    await expect(store().delete('c', {})).rejects.toThrow('empty filter');
    await expect(store().delete('c', { opus_path: '' })).rejects.toThrow('empty filter');
    await expect(store().delete('c', { opus_path: [] })).rejects.toThrow('empty filter');
    expect(calls).toHaveLength(0);
    await store().delete('c', { opus_path: 'seneca/de-vita' });
    expect(calls[0].body).toEqual({ filter: { must: [{ key: 'opus_path', match: { value: 'seneca/de-vita' } }] } });
  });

  it('sends the API key when configured', async () => {
    const calls = mockFetch([{ body: { result: { count: 3 } } }]);
    expect(await store({ apiKey: 'k' }).count('c')).toBe(3);
    expect(calls[0].headers['api-key']).toBe('k');
  });
});
