import { assert } from "console";
import { Content } from "../model/model"
import { MilvusCollection } from "./milvus/milvuscollection.service";
import { QdrantCollection } from "./qdrant/qdrantcollection.service";
import { Injectable } from "@nestjs/common";

export interface VectorStore {
    store(data: Content[]): Promise<any>;
    storeNewOrUpdated(data: Content[]): Promise<any>
    flush(): Promise<any>;
    removeOpus(opusPath: string): Promise<any>;
    // Drop and recreate the underlying collection - see
    // VectorizingJobService.start() for why a full re-vectorize truncates
    // first rather than layering onto the existing collection.
    reset(): Promise<any>;
    /**
     * "Vectors are precious" (a full corpus embed takes days, not an
     * index rebuild): which of the given paragraphs ALREADY have a stored
     * vector (by sha256), and the url each one is currently stored under -
     * so the vectorizer embeds only the rest and repoints these instead
     * (see repointUrls). Never a drop/truncate: read-only.
     */
    alreadyStored(items: { sha256: string; url: string }[]): Promise<{ sha256: string; url: string }[]>;
    /**
     * Repoint already-stored vectors (by sha256) to their - possibly
     * renamed - url WITHOUT re-embedding and without deleting anything: a
     * book rename changes every paragraph's url (author/work-title is in
     * it) while the paragraph texts - and so their sha256s and vectors -
     * stay identical.
     */
    repointUrls(items: { sha256: string; url: string }[]): Promise<any>;
    // Manually reclaim storage from deleted/updated rows - a real, needed
    // operation on Milvus (append-only binlogs, only lazily GC'd otherwise -
    // see VectorizingJobService.start()'s own comment on the 40G-of-stale-
    // binlogs incident). Qdrant compacts automatically in the background,
    // so its implementation is a no-op - AppController's /api/optimize
    // stays callable regardless of which store is active.
    compact(): Promise<any>;
}

@Injectable()
export class MilvusColVectorStore implements VectorStore {
    constructor(protected col: MilvusCollection) {}

    get collection() { return this.col; }

    async store(data: Content[]): Promise<any> {
        data.forEach(it => {
            assert(it.sha256 != null);
            assert(it.url != null);
            assert(it.embedding != null);
        })
        return await this.col.upsert(data);
    }

    async flush() {
        return await this.col.flush();
    }

    async storeNewOrUpdated(data: Content[]): Promise<any> {
        return await this.col.upsertNewOrModified(data);
    }

    async removeOpus(opusPath: string): Promise<any> {
        return await this.col.deleteByUrlPrefix(opusPath);
    }

    async alreadyStored(items: { sha256: string; url: string }[]): Promise<{ sha256: string; url: string }[]> {
        // URL too: the vectorizer needs it to detect renames (same sha,
        // new url = repoint, not re-embed).
        const found = await this.col.findById(items.map(it => it.sha256),
            [MilvusCollection.SHA256, MilvusCollection.URL]);
        return found.map(it => ({ sha256: it.sha256 as string, url: it.url as string }));
    }

    async repointUrls(items: { sha256: string; url: string }[]): Promise<any> {
        // Milvus is retired infrastructure (its dedicated integration
        // instance is gone, the store path is qdrant) - implementing
        // url-repointing on the milvus SDK would need a vector-fetch +
        // re-upsert roundtrip nobody will ever run.
        throw new Error('repointUrls is only implemented for the qdrant store (milvus is retired)');
    }

    async reset(): Promise<any> {
        await this.col.drop();
        await this.col.createAndLoadIfNotExists();
    }

    async compact(): Promise<any> {
        return await this.col.compact();
    }

}

/**
 * The qdrant counterpart of MilvusColVectorStore - same VectorStore
 * contract over QdrantCollection (VECTOR_STORE=qdrant), so the
 * vectorizer pipeline never knows which store it writes to.
 */
@Injectable()
export class QdrantVectorStore implements VectorStore {
    constructor(protected col: QdrantCollection) {}

    get collection() { return this.col; }

    async store(data: Content[]): Promise<any> {
        data.forEach(it => {
            assert(it.sha256 != null);
            assert(it.url != null);
            assert(it.embedding != null);
        })
        return await this.col.upsert(data);
    }

    async flush() {
        return await this.col.flush();
    }

    async storeNewOrUpdated(data: Content[]): Promise<any> {
        return await this.col.upsertNewOrModified(data);
    }

    async removeOpus(opusPath: string): Promise<any> {
        return await this.col.deleteByOpusPath(opusPath);
    }

    async alreadyStored(items: { sha256: string; url: string }[]): Promise<{ sha256: string; url: string }[]> {
        const found = await this.col.findById(items.map(it => it.sha256));
        return found.map(it => ({ sha256: it.sha256 as string, url: it.url as string }));
    }

    async repointUrls(items: { sha256: string; url: string }[]): Promise<any> {
        return await this.col.repointUrls(items);
    }

    async reset(): Promise<any> {
        await this.col.drop();
        await this.col.createAndLoadIfNotExists();
    }

    async compact(): Promise<any> {
        return { skipped: 'Qdrant compacts automatically; no manual action needed.' };
    }
}

export const PROVIDER_VECTOR_STORE = Symbol('VectorStore')