import { CollectionSpec, VectorCollectionManager, VectorStore } from "../ragtime/core";

/** The ragtime Embedder of the active model (see app.module.ts). */
export const PROVIDER_EMBEDDER = Symbol('Embedder');

/** The ragtime ChatModel answering RAG questions and rewriting follow-ups. */
export const PROVIDER_CHAT_MODEL = Symbol('ChatModel');

/** The BibliotecaVectorCollection the paragraphs' vectors live in. */
export const PROVIDER_VECTOR_COLLECTION = Symbol('BibliotecaVectorCollection');

/**
 * Biblioteca's paragraph vectors: the store, the collection name (which the
 * server's shared config carries, per environment) and what it must be,
 * plus the one explicit, manual way to drop them all.
 */
export class BibliotecaVectorCollection {
    constructor(
        readonly store: VectorStore,
        private readonly manager: VectorCollectionManager,
        readonly name: string,
        readonly spec: CollectionSpec,
    ) {}

    /** Creates the collection if missing, then checks it can hold this embedder's vectors. */
    async ensure(): Promise<void> {
        await this.manager.ensure(this.name, this.spec);
    }

    assertCompatible(): Promise<void> {
        return this.manager.assertCompatible(this.name, this.spec);
    }

    /**
     * Drop and recreate the collection - manual only (POST
     * /api/vector-store/reset): by policy nothing in the automatic flow ever
     * drops vectors ("vectors are precious": a full corpus embed takes days).
     */
    async reset(): Promise<void> {
        await this.manager.drop(this.name);
        await this.manager.ensure(this.name, this.spec);
    }
}
