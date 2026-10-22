import { FilterValue, StoredPayload, VectorFilter, VectorQueryResult, VectorRecord, VectorStore } from './model';

/** Whether a payload satisfies every condition of the filter. */
export function matchesFilter(payload: Record<string, unknown>, filter?: VectorFilter): boolean {
  return Object.entries(filter ?? {}).every(([key, wanted]) =>
    Array.isArray(wanted) ? wanted.includes(payload[key] as FilterValue) : payload[key] === wanted);
}

/**
 * VectorStore in RAM: for collections of human dimensions, and as the store
 * of tests. Exact (brute-force) search; Euclid distances, lower is closer.
 */
export class MemoryVectorStore implements VectorStore {
  private readonly collections = new Map<string, Map<string, { vector: number[]; payload: Record<string, unknown> }>>();

  private points(collection: string) {
    let points = this.collections.get(collection);
    if (!points) this.collections.set(collection, (points = new Map()));
    return points;
  }

  /** The stored vector and payload of an id, for assertions. */
  get(collection: string, id: string): { vector: number[]; payload: Record<string, unknown> } | undefined {
    return this.points(collection).get(id);
  }

  async upsert(collection: string, records: VectorRecord[]): Promise<void> {
    for (const record of records) this.points(collection).set(record.id, { vector: [...record.vector], payload: { ...record.payload } });
  }

  async query(collection: string, vector: number[], topK: number, filter?: VectorFilter): Promise<VectorQueryResult[]> {
    return [...this.points(collection).entries()]
      .filter(([, point]) => matchesFilter(point.payload, filter))
      .map(([id, point]) => ({
        id,
        score: Math.sqrt(point.vector.reduce((sum, value, i) => sum + (value - (vector[i] ?? 0)) ** 2, 0)),
        scoreKind: 'distance' as const,
        payload: point.payload,
      }))
      .sort((a, b) => a.score - b.score)
      .slice(0, topK);
  }

  async retrieve(collection: string, ids: string[]): Promise<StoredPayload[]> {
    return [...new Set(ids)].flatMap((id) => {
      const point = this.points(collection).get(id);
      return point ? [{ id, payload: point.payload }] : [];
    });
  }

  async setPayload(collection: string, updates: StoredPayload[]): Promise<void> {
    for (const update of updates) {
      const point = this.points(collection).get(update.id);
      if (point) point.payload = { ...update.payload };
    }
  }

  async delete(collection: string, filter: VectorFilter): Promise<void> {
    if (Object.keys(filter ?? {}).length === 0) throw new Error(`Refusing to delete from ${collection} with an empty filter`);
    for (const [id, point] of this.points(collection)) if (matchesFilter(point.payload, filter)) this.points(collection).delete(id);
  }

  async count(collection: string, filter?: VectorFilter): Promise<number> {
    return [...this.points(collection).values()].filter((point) => matchesFilter(point.payload, filter)).length;
  }
}
