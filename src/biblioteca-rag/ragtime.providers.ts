import { OllamaChatModel } from '../ragtime/adapters/ollama.chat-model';
import { DEFAULT_GENERATION_MODEL } from '../ragtime/adapters/ollama.model-finder';
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

/**
 * How long the chat model stays loaded on the shared Ollama after each use.
 * Ollama's default unloads it after 5 idle minutes, and reloading the 9B model
 * made the next chat wait ~50 s (6 reloads a day on zmeu). The GPU holds it
 * next to the pinned bge-m3 embedder with room to spare.
 */
export const CHAT_MODEL_KEEP_ALIVE = '6h';

/** Biblioteca's chat model: the shared Ollama's generating model, kept loaded. */
export function bibliotecaChatModel(ollamaUrl: string): OllamaChatModel {
  return new OllamaChatModel({ url: ollamaUrl, defaultModel: DEFAULT_GENERATION_MODEL, keepAlive: CHAT_MODEL_KEEP_ALIVE });
}
