import { Content } from '../../model/model';

/**
 * Qdrant-backed collection - the write-path counterpart of
 * MilvusCollection for VECTOR_STORE=qdrant, speaking the same
 * shape-of-data (sha256 + url + a dense "embedding" vector, the same
 * convention-carrying collection name from the server's shared config)
 * through Qdrant's REST API.
 *
 * REST (the 6333 HTTP surface, Node's global fetch) rather than the
 * official client package on purpose: no new dependency, and the four
 * operations this worker needs (create, upsert, retrieve, delete) are
 * plain JSON calls - the client package would add install/lockfile churn
 * for no functional gain.
 *
 * Index choices (see create()):
 * - dense: HNSW (m=16, ef_construct=100), Euclid (L2) distance - the
 *   same lower-is-closer semantics as the Milvus L2 collections, so
 *   scores and ranking order are comparable across stores.
 * - scalar int8 quantization, always_ram: the counterpart of
 *   MilvusCollection's IVF_SQ8 rationale (idx_ivfsq8_l2_8192) - the
 *   target corpus at full precision would not fit the host's RAM.
 * - keyword payload indexes on sha256, url and opus_path: exact-match
 *   lookups and the opus-removal filter without a scan.
 *
 * Qdrant's IR-grade options (full-text payload index, sparse vectors /
 * BM25-style scoring) are deliberately NOT configured: the deployment's
 * information-retrieval search is Lucene's job on the server side, and
 * a qdrant sparse vector would need an embedder emitting one (bge-m3's
 * sparse output, not exposed through Ollama's /api/embed).
 *
 * Qdrant point IDs must be UUIDs, and a sha256 hex digest is not one:
 * the first 32 hex chars of the sha256, formatted as a UUID, are the
 * deterministic point ID (see pointIdOf) - the actual sha256 travels
 * in the payload regardless, and the id is an implementation detail.
 */
export class QdrantCollection {

    public static readonly EMBEDDING = 'embedding';
    public static readonly SHA256 = 'sha256';
    public static readonly URL: string = 'url';
    // Derived from Content.url at write time (the 'author/opus' path - the
    // first two segments), so removeOpus can be an exact, keyword-indexed
    // payload match instead of MilvusCollection's four LIKE patterns: the
    // opus path is unique per opus, so an exact match can never catch a
    // 'author/opus-longa' sibling either.
    public static readonly OPUS_PATH: string = 'opus_path';

    static readonly NOOP_MUTATION_RESULT = { upsert_cnt: '0', deleted: 0 };

    constructor(
        public name: string,
        protected qdrantUrl: string,
        protected vectorDim: number,
        // Should identify the encoder this collection's vectors come from -
        // same convention as MilvusCollection's description. Qdrant has no
        // collection-description field, so this is only used in logs.
        protected description: string = `embeddings storage, collection ${name}`) {}

    /**
     * Deterministic Qdrant point ID for a sha256: the first 32 hex chars
     * formatted as a UUID (see the class comment). Must stay in sync with
     * biblioteca-server's QdrantCollection.pointIdOf.
     */
    static pointIdOf(sha256: string): string {
        const hex = sha256.length >= 32 ? sha256.substring(0, 32) : sha256;
        return hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    }

    /** 'author/opus' of a stored paragraph URL - see OPUS_PATH. */
    static opusPathOf(url: string): string {
        try {
            const pathname = new URL(url).pathname.replace(/^\/+/, '');
            return pathname.split('/').slice(0, 2).join('/');
        } catch {
            return '';
        }
    }

    private async request(method: string, path: string, body?: unknown): Promise<any> {
        const resp = await fetch(`${this.qdrantUrl}${path}`, {
            method,
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!resp.ok)
            throw new Error(`Qdrant ${method} ${path} -> HTTP ${resp.status}: ${await resp.text()}`);
        return resp.json();
    }

    async exists(): Promise<boolean> {
        const resp = await fetch(`${this.qdrantUrl}/collections/${this.name}`);
        if (resp.status === 404)
            return false;
        if (!resp.ok)
            throw new Error(`Qdrant GET /collections/${this.name} -> HTTP ${resp.status}`);
        return true;
    }

    async create() {
        await this.request('PUT', `/collections/${this.name}`, {
            vectors: {
                [QdrantCollection.EMBEDDING]: { size: this.vectorDim, distance: 'Euclid' },
            },
            hnsw_config: { m: 16, ef_construct: 100 },
            quantization_config: { scalar: { type: 'int8', always_ram: true } },
        });
        for (const field of [QdrantCollection.SHA256, QdrantCollection.URL, QdrantCollection.OPUS_PATH]) {
            await this.request('PUT', `/collections/${this.name}/index`,
                { field_name: field, field_schema: 'keyword' });
        }
    }

    /**
     * The factory entry point of app.module - same contract as
     * MilvusCollection.createAndLoadIfNotExists, except "load" is a no-op:
     * a qdrant collection is always ready to serve (no release/load
     * lifecycle like Milvus's).
     */
    async createAndLoadIfNotExists() {
        if (!(await this.exists()))
            await this.create();
    }

    async assertVectorDimensionMatches(vectorDim: number) {
        const resp = await this.request('GET', `/collections/${this.name}`);
        const size = resp?.result?.config?.params?.vectors?.[QdrantCollection.EMBEDDING]?.size;
        if (size !== vectorDim)
            throw new Error(
                `Qdrant collection '${this.name}' vector dimension ${size} does not match the embedder's ${vectorDim}.`);
    }

    async drop() {
        await this.request('DELETE', `/collections/${this.name}`);
    }

    /**
     * Same dedup-by-sha256 as MilvusCollection.toRows: a batch whose
     * paragraphs repeat a text carries duplicate point IDs, and one point
     * ID must occur only once per upsert.
     */
    protected toPoints(content: Content[]) {
        if (!content)
            return [];
        const bySha = new Map<string, Content>();
        for (const it of content)
            bySha.set(it.sha256, it);
        return [...bySha.values()].map(it => ({
            id: QdrantCollection.pointIdOf(it.sha256),
            vector: { [QdrantCollection.EMBEDDING]: it.embedding },
            payload: {
                [QdrantCollection.SHA256]: it.sha256,
                [QdrantCollection.URL]: it.url,
                [QdrantCollection.OPUS_PATH]: QdrantCollection.opusPathOf(it.url),
            },
        }));
    }

    async upsert(content: Content[]): Promise<any> {
        const points = this.toPoints(content);
        if (points.length === 0)
            return QdrantCollection.NOOP_MUTATION_RESULT;
        return await this.request('PUT', `/collections/${this.name}/points?wait=true`,
            { points });
    }

    /**
     * The stored {sha256, url} of the given hashes - only the ones that
     * exist (Qdrant omits unknown ids, same semantics as
     * MilvusCollection.findById's query results).
     */
    async findById(sha256s: string[]): Promise<Partial<Content>[]> {
        if (!sha256s?.length)
            return [];
        const resp = await this.request('POST', `/collections/${this.name}/points`, {
            ids: sha256s.map(it => QdrantCollection.pointIdOf(it)),
            with_payload: true,
            with_vector: false,
        });
        return (resp?.result ?? []).map((point: any) => ({
            sha256: point.payload?.[QdrantCollection.SHA256],
            url: point.payload?.[QdrantCollection.URL],
        }));
    }

    /**
     * Mirrors MilvusCollection.newOrModified: only the contents that are
     * entirely new, or whose url changed for the same text hash.
     */
    async newOrModified(content: Content[]): Promise<Content[]> {
        const alreadyExisting = await this.findById(
            content.map(it => it.sha256));
        const alreadyExistingIds = alreadyExisting.map(it => it.sha256);

        return content.filter(c => {
            const indexOfSha = alreadyExistingIds.indexOf(c.sha256);
            if (indexOfSha < 0)
                return true; // id not found so this is entirely new
            return (c.url !== alreadyExisting[indexOfSha].url); // url changed = modified
        });
    }

    async upsertNewOrModified(content: Content[]): Promise<any> {
        const newOrModified = await this.newOrModified(content);
        if (newOrModified.length != content.length) {
            // eslint-disable-next-line no-console
            console.log(`will only upsert ${newOrModified.length} new or modified out of ${content.length} total`);
        }
        return this.upsert(newOrModified);
    }

    /**
     * Exact-match delete on the derived opus_path payload (see OPUS_PATH) -
     * the keyword index makes it a point lookup, no scan.
     */
    async deleteByOpusPath(opusPath: string): Promise<any> {
        if (!opusPath?.trim())
            throw new Error(`Cannot delete Qdrant vectors for an empty opus path`);
        return await this.request('POST', `/collections/${this.name}/points/delete?wait=true`, {
            filter: { must: [{ key: QdrantCollection.OPUS_PATH, match: { value: opusPath } }] },
        });
    }

    async count(): Promise<number> {
        const resp = await this.request('POST', `/collections/${this.name}/points/count`,
            { exact: true });
        return resp?.result?.count ?? 0;
    }

    /**
     * A deliberate no-op: Qdrant persists and optimizes its segments on its
     * own schedule (there is no Milvus-style flush call to make) - the
     * VectorStore contract keeps the method so callers don't care.
     */
    async flush(): Promise<any> {
        return QdrantCollection.NOOP_MUTATION_RESULT;
    }
}
