import { assert } from "console";
import { Content } from "../model/model"
import { MilvusCollection } from "./milvus/milvuscollection.service";
import { Injectable } from "@nestjs/common";

export interface VectorStore {
    store(data: Content[]): Promise<any>;
    storeNewOrUpdated(data: Content[]): Promise<any>
    flush(): Promise<any>;
    removeOpus(opusPath: string): Promise<any>;
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

}

export const PROVIDER_VECTOR_STORE = Symbol('VectorStore')