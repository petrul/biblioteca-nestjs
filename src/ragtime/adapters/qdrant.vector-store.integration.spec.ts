/// <reference types="jest" />
import { QdrantVectorStore } from './qdrant.vector-store';
import { TestUtils } from '../../../test/testutils';
import { BIBLIOTECA_QDRANT_TUNING, bibliotecaCollectionSpec } from '../../biblioteca-rag/biblioteca.source';

/**
 * Live integration against the shared Qdrant instance (QDRANT_URL, default
 * zmeu.local:6333). It only ever creates and drops its own test_* collections.
 */
describe('QdrantVectorStore (live integration)', () => {
  jest.setTimeout(TestUtils.TIMEOUT_TWO_MINUTES);

  const qdrantUrl = process.env.QDRANT_URL || 'http://zmeu.local:6333';
  const DIM = 384;
  const spec = bibliotecaCollectionSpec(DIM);
  const store = new QdrantVectorStore({ url: qdrantUrl, idField: 'sha256', tuning: BIBLIOTECA_QDRANT_TUNING });
  let collection: string;

  beforeEach(async () => {
    collection = 'test_' + TestUtils.randomAlphanumeric();
    await store.ensure(collection, spec);
    await store.assertCompatible(collection, spec);
  });

  afterEach(async () => {
    try { await store.drop(collection); } catch { /* already gone */ }
  });

  it('upserts idempotently and retrieves what it stored', async () => {
    const records = TestUtils.randomRecords(10, DIM);
    await store.upsert(collection, records);
    await store.upsert(collection, records); // again: no duplicates
    expect(await store.count(collection)).toBe(10);
    const stored = await store.retrieve(collection, records.map((r) => r.id));
    expect(stored.map((s) => s.id).sort()).toEqual(records.map((r) => r.id).sort());
    expect(await store.retrieve(collection, ['f'.repeat(64)])).toEqual([]);
  });

  it('repoints payloads without touching the vectors', async () => {
    const records = TestUtils.randomRecords(3, DIM);
    await store.upsert(collection, records);
    await store.setPayload(collection, records.map((r, i) => ({ id: r.id, payload: { ...r.payload, url: `http://server:8080/renamed/p${i}` } })));

    const stored = await store.retrieve(collection, records.map((r) => r.id));
    stored.forEach((s) => expect(String(s.payload.url).startsWith('http://server:8080/renamed/')).toBe(true));
    const nearest = await store.query(collection, records[0].vector, 1);
    expect(nearest[0]).toMatchObject({ id: records[0].id, scoreKind: 'distance' });
    expect(nearest[0].score).toBeLessThan(0.05); // int8 quantization: near zero, not exactly
  });

  it('scopes queries and deletes to one work, never its similarly-prefixed sibling', async () => {
    await store.upsert(collection, [
      ...TestUtils.randomRecords(2, DIM, 'seneca/de-vita'),
      ...TestUtils.randomRecords(2, DIM, 'seneca/de-vita-longa'),
    ]);
    const probe = TestUtils.randomRecords(1, DIM)[0].vector;
    const scoped = await store.query(collection, probe, 10, { opus_path: ['seneca/de-vita'] });
    expect(scoped.map((r) => r.payload.opus_path)).toEqual(['seneca/de-vita', 'seneca/de-vita']);

    await store.delete(collection, { opus_path: 'seneca/de-vita' });
    expect(await store.count(collection, { opus_path: 'seneca/de-vita' })).toBe(0);
    expect(await store.count(collection, { opus_path: 'seneca/de-vita-longa' })).toBe(2);
  });
});
