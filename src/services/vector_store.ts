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

    async reset(): Promise<any> {
        await this.col.drop();
        await this.col.createAndLoadIfNotExists();
    }

    async compact(): Promise<any> {
        return { skipped: 'Qdrant compacts automatically; no manual action needed.' };
    }
}

export const PROVIDER_VECTOR_STORE = Symbol('VectorStore')