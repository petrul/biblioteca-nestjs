import { assert } from "console";
import { Content } from "../model/model"
import { MilvusCollection } from "./milvus/milvuscollection.service";

export interface VectorStore {
    store(data: Content[]): Promise<void>;
}

export class MilvusColVectorStore implements VectorStore {
    constructor(protected col: MilvusCollection) {}

    async store(data: Content[]): Promise<any> {
        data.forEach(it => {
            assert(it.embedding != null);
        })
        return await this.col.upsert(data);
    }
}

export const PROVIDER_VECTOR_STORE = Symbol('VectorStore')