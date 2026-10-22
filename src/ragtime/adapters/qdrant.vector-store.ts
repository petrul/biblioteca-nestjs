import { createHash } from 'node:crypto';
import {
  CollectionSpec, ScoreKind, StoredPayload, VectorCollectionManager, VectorFilter, VectorMetric, VectorQueryResult, VectorRecord, VectorStore,
} from '../core';

/** Qdrant-specific tuning of the collections ensure() creates. */
export interface QdrantCollectionTuning {
  hnsw?: { m: number; ef_construct: number };
  /** Scalar int8 quantization kept in RAM: ~4x less memory for large collections. */
  int8Quantization?: boolean;
}

const QDRANT_DISTANCE: Record<VectorMetric, string> = { euclid: 'Euclid', cosine: 'Cosine', dot: 'Dot' };

export interface QdrantVectorStoreOptions {
  url: string;
  apiKey?: string;
  /** The named vector the collections use. Default 'embedding'. */
  vectorName?: string;
  /** Payload field carrying the item id (point ids are UUIDs derived from it). Default 'id'. */
  idField?: string;
  /** Applied to every collection ensure() creates. */
  tuning?: QdrantCollectionTuning;
  timeoutMs?: number;
}

type QdrantPoint = { id: string | number; score?: number; payload?: Record<string, unknown> };

/**
 * VectorStore and VectorCollectionManager over Qdrant's REST API (Node's
 * fetch: a handful of JSON calls need no client package).
 *
 * Qdrant point ids must be UUIDs (or integers): pointIdOf derives one from the
 * item id, and the item id itself travels in the payload (idField), so stores,
 * queries and lookups all speak item ids.
 */
export class QdrantVectorStore implements VectorStore, VectorCollectionManager {
  private readonly url: string;
  private readonly vectorName: string;
  private readonly idField: string;
  private readonly timeoutMs: number;
  private readonly scoreKinds = new Map<string, ScoreKind>();

  constructor(private readonly options: QdrantVectorStoreOptions) {
    this.url = options.url.replace(/\/+$/, '');
    this.vectorName = options.vectorName ?? 'embedding';
    this.idField = options.idField ?? 'id';
    this.timeoutMs = options.timeoutMs ?? 300_000;
  }

  /**
   * Deterministic point id: an id that is a hex digest of 32+ chars gives its
   * first 32 hex chars as a UUID (so a sha256 maps exactly as
   * biblioteca-server's QdrantCollection.pointIdOf maps it - keep the two in
   * sync); any other id is hashed with sha256 first.
   */
  static pointIdOf(id: string): string {
    const hex = /^[0-9a-f]{32,}$/i.test(id) ? id : createHash('sha256').update(id).digest('hex');
    return hex.substring(0, 32).toLowerCase().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  }

  /** Qdrant's filter for a VectorFilter; undefined for no conditions. */
  static toQdrantFilter(filter?: VectorFilter): { must: unknown[] } | undefined {
    const must = Object.entries(filter ?? {}).map(([key, value]) =>
      Array.isArray(value) ? { key, match: { any: value } } : { key, match: { value } });
    return must.length > 0 ? { must } : undefined;
  }

  private async request(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<any> {
    const response = await fetch(`${this.url}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(this.options.apiKey ? { 'api-key': this.options.apiKey } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (okStatuses.includes(response.status)) return { status: response.status };
    if (!response.ok) throw new Error(`Qdrant ${method} ${path} -> HTTP ${response.status}: ${await response.text()}`);
    return response.json();
  }

  async exists(collection: string): Promise<boolean> {
    const result = await this.request('GET', `/collections/${collection}`, undefined, [404]);
    return result.status !== 404;
  }

  /** Creates the collection, with keyword indexes on spec.indexedFields, if missing; leaves an existing one as it is. */
  async ensure(collection: string, spec: CollectionSpec): Promise<void> {
    if (await this.exists(collection)) return;
    const tuning = this.options.tuning ?? {};
    await this.request('PUT', `/collections/${collection}`, {
      vectors: { [this.vectorName]: { size: spec.dimension, distance: QDRANT_DISTANCE[spec.metric] } },
      ...(tuning.hnsw ? { hnsw_config: tuning.hnsw } : {}),
      ...(tuning.int8Quantization ? { quantization_config: { scalar: { type: 'int8', always_ram: true } } } : {}),
    });
    for (const field of spec.indexedFields ?? []) {
      await this.request('PUT', `/collections/${collection}/index`, { field_name: field, field_schema: 'keyword' });
    }
  }

  private async vectorConfig(collection: string): Promise<{ size?: number; distance?: string } | undefined> {
    const response = await this.request('GET', `/collections/${collection}`);
    return response?.result?.config?.params?.vectors?.[this.vectorName];
  }

  /** Fails loudly on a stale collection (another embedder's vectors) instead of at the first upsert. */
  async assertCompatible(collection: string, spec: CollectionSpec): Promise<void> {
    const config = await this.vectorConfig(collection);
    if (config?.size !== spec.dimension || config?.distance !== QDRANT_DISTANCE[spec.metric]) {
      throw new Error(`Qdrant collection '${collection}' holds ${config?.size}-dim ${config?.distance} vectors, `
        + `not the ${spec.dimension}-dim ${QDRANT_DISTANCE[spec.metric]} ones expected.`);
    }
  }

  /** Euclid scores are distances, Cosine/Dot ones similarities - read once per collection. */
  private async scoreKindOf(collection: string): Promise<ScoreKind> {
    let kind = this.scoreKinds.get(collection);
    if (!kind) {
      kind = (await this.vectorConfig(collection))?.distance === 'Euclid' ? 'distance' : 'similarity';
      this.scoreKinds.set(collection, kind);
    }
    return kind;
  }

  async drop(collection: string): Promise<void> {
    this.scoreKinds.delete(collection);
    await this.request('DELETE', `/collections/${collection}`);
  }

  async upsert(collection: string, records: VectorRecord[]): Promise<void> {
    // one point id must occur once per upsert: the last record of an id wins
    const byId = new Map(records.map((record) => [record.id, record]));
    if (byId.size === 0) return;
    await this.request('PUT', `/collections/${collection}/points?wait=true`, {
      points: [...byId.values()].map((record) => ({
        id: QdrantVectorStore.pointIdOf(record.id),
        vector: { [this.vectorName]: record.vector },
        payload: { ...record.payload, [this.idField]: record.id },
      })),
    });
  }

  private itemId(point: QdrantPoint): string {
    const id = point.payload?.[this.idField];
    return typeof id === 'string' ? id : String(point.id);
  }

  async query(collection: string, vector: number[], topK: number, filter?: VectorFilter): Promise<VectorQueryResult[]> {
    const scoreKind = await this.scoreKindOf(collection);
    const response = await this.request('POST', `/collections/${collection}/points/query`, {
      query: vector,
      using: this.vectorName,
      limit: topK,
      with_payload: true,
      ...(QdrantVectorStore.toQdrantFilter(filter) ? { filter: QdrantVectorStore.toQdrantFilter(filter) } : {}),
      // Qdrant (1.13) answers a filtered query over a small subset from the
      // int8 vectors alone, without rescoring: raw quantized scores (7.8
      // for a true Euclid distance of 0.86) in the wrong order. Rescoring
      // with the full vectors is asked for explicitly.
      ...(this.options.tuning?.int8Quantization ? { params: { quantization: { rescore: true, oversampling: 2 } } } : {}),
    });
    return ((response?.result?.points ?? []) as QdrantPoint[]).map((point) => ({
      id: this.itemId(point),
      score: point.score ?? 0,
      scoreKind,
      payload: point.payload ?? {},
    }));
  }

  async retrieve(collection: string, ids: string[]): Promise<StoredPayload[]> {
    if (ids.length === 0) return [];
    const response = await this.request('POST', `/collections/${collection}/points`, {
      ids: [...new Set(ids)].map((id) => QdrantVectorStore.pointIdOf(id)),
      with_payload: true,
      with_vector: false,
    });
    return ((response?.result ?? []) as QdrantPoint[]).map((point) => ({ id: this.itemId(point), payload: point.payload ?? {} }));
  }

  async setPayload(collection: string, updates: StoredPayload[]): Promise<void> {
    if (updates.length === 0) return;
    await this.request('POST', `/collections/${collection}/points/batch?wait=true`, {
      operations: updates.map((update) => ({
        overwrite_payload: {
          points: [QdrantVectorStore.pointIdOf(update.id)],
          payload: { ...update.payload, [this.idField]: update.id },
        },
      })),
    });
  }

  async delete(collection: string, filter: VectorFilter): Promise<void> {
    const qdrantFilter = QdrantVectorStore.toQdrantFilter(filter);
    const empty = Object.values(filter ?? {}).some((value) => value === '' || (Array.isArray(value) && value.length === 0));
    if (!qdrantFilter || empty) throw new Error(`Refusing to delete from ${collection} with an empty filter`);
    await this.request('POST', `/collections/${collection}/points/delete?wait=true`, { filter: qdrantFilter });
  }

  async count(collection: string, filter?: VectorFilter): Promise<number> {
    const qdrantFilter = QdrantVectorStore.toQdrantFilter(filter);
    const response = await this.request('POST', `/collections/${collection}/points/count`, {
      exact: true,
      ...(qdrantFilter ? { filter: qdrantFilter } : {}),
    });
    return response?.result?.count ?? 0;
  }
}
