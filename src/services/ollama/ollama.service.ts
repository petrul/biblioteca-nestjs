import { Inject, Injectable } from "@nestjs/common";
import { PROVIDER_CONF, VectorizerConfiguration } from "../../configuration";
import { Content, ContentEmbedder } from "../../model/model";
import { assert } from "console";

/** Shape of Ollama's POST /api/embed JSON response (ignoring the timing/count fields we don't need). */
interface OllamaEmbedResponse {
    model: string;
    embeddings: number[][];
}

/**
 * Low-level client for an Ollama server's batch-capable POST /api/embed
 * endpoint (not the older singular /api/embeddings, which only takes one
 * prompt at a time and returns a single vector). Any model already pulled
 * on the Ollama server can be used here just by name.
 */
@Injectable()
export class OllamaService {

    constructor(@Inject(PROVIDER_CONF) protected conf: VectorizerConfiguration) {}

    async encode(model: string, sentences: string[]): Promise<number[][]> {
        const resp = await fetch(`${this.conf.ollamaServer}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, input: sentences }),
        });
        if (!resp.ok) {
            throw new Error(`Ollama /api/embed failed for model '${model}': HTTP ${resp.status} ${await resp.text()}`);
        }
        const data = await resp.json() as OllamaEmbedResponse;
        if (!data.embeddings) {
            throw new Error(`Ollama /api/embed returned no embeddings for model '${model}'`);
        }
        return data.embeddings;
    }
}

export interface OllamaEncoder {
    encode(sentences: string[]): Promise<number[][]>;
}

/**
 * Shared ContentEmbedder adapter for any Ollama-backed embedding model -
 * mirrors AllMpnetBaseV2_StsService's role for the sentence-transformers
 * server, but generic over the model name instead of hardcoded, since
 * Ollama has no fixed model catalog the way the STS server does. Concrete
 * subclasses just pin a model name (see BgeM3OllamaService and the other
 * concrete adapters below).
 */
export abstract class OllamaContentEmbedderBase implements OllamaEncoder, ContentEmbedder {

    constructor(protected ollama: OllamaService) {}

    protected abstract get modelName(): string;

    abstract readonly supportedLanguages: string[] | 'all';

    /**
     * Per-model context-window floor in characters - each subclass pins
     * this to (its model's token context) x (a conservative ~2 chars/token
     * for the corpus's Latin/Cyrillic text), so the vectorizer's
     * truncation can never hand the model more than it accepts.
     */
    abstract readonly maxContextChars: number;

    /**
     * this is the actual api call
     */
    encode(sentences: string[]): Promise<number[][]> {
        return this.ollama.encode(this.modelName, sentences);
    }

    /**
     * @param content this is an adapter to Content
     */
    async embeddings(content: Content[]): Promise<Content[]> {
        const sentences = content.map(it => it.text);
        const vectors = await this.encode(sentences);
        assert(vectors.length == sentences.length);
        vectors.forEach((val, i) => {
            const emb = vectors[i];
            assert(emb != null);
            content[i].embedding = emb;
        });
        return content;
    }
}

/**
 * Ollama-backed embedder for whichever model textbase-server's shared
 * config (GET /api/admin/config) reports as its active one -- unlike
 * BgeM3OllamaService/Qwen3EmbeddingOllamaService/NomicEmbedOllamaService
 * below (each pinned to one hardcoded model), this is constructed directly
 * with the model name at runtime, since biblioteca-nestjs must use exactly
 * whatever textbase-server says, not its own independent choice. See
 * app.module.ts's PROVIDER_EMBEDDER factory.
 *
 * supportedLanguages defaults to 'all': textbase-server's actual current
 * default (BGE-M3) and Qwen3-Embedding are both genuinely multilingual, so
 * this is correct for either. It would be wrong if textbase-server ever
 * switched its default to nomic-embed-text (English-only) -- a narrower
 * gap than the ones this whole mechanism closes (topic/collection/model
 * identity), since it degrades embedding quality for some languages rather
 * than producing an outright cross-service mismatch.
 */
export class DynamicOllamaEmbedder extends OllamaContentEmbedderBase {
    readonly supportedLanguages: string[] | 'all' = 'all';

    // bge-m3 (8192-token context) is the server's current default and the
    // smallest-context model this can be constructed with; qwen3-embedding
    // (32K) only accepts more, so its own floor is covered by this too.
    // Revisit if the server's active embedder ever switches to a
    // smaller-context model (nomic has its own pinned class below).
    readonly maxContextChars = 16384;

    constructor(ollama: OllamaService, private readonly ollamaModelName: string) {
        super(ollama);
    }

    protected get modelName(): string {
        return this.ollamaModelName;
    }
}

/** Multilingual BGE-M3 embeddings served by Ollama (1024 dimensions). */
@Injectable()
export class BgeM3OllamaService extends OllamaContentEmbedderBase {
    static readonly modelName = 'bge-m3';

    readonly supportedLanguages: string[] | 'all' = 'all';

    // bge-m3: 8192-token context, ~2 chars/token conservative.
    readonly maxContextChars = 16384;

    constructor(ollama: OllamaService) {
        super(ollama);
    }

    protected get modelName(): string {
        return BgeM3OllamaService.modelName;
    }
}

@Injectable()
export class Qwen3EmbeddingOllamaService extends OllamaContentEmbedderBase {
    static readonly modelName = 'qwen3-embedding:4b';

    // Qwen3-Embedding is documented (Alibaba's own model card) as trained
    // for and evaluated on 100+ languages - genuinely multilingual, unlike
    // the STS models above.
    readonly supportedLanguages: string[] | 'all' = 'all';

    // qwen3-embedding: 32K-token context.
    readonly maxContextChars = 32768;

    // explicit constructor required even though it just forwards to super():
    // NestJS's DI resolves constructor params via TypeScript's emitted
    // design:paramtypes metadata, which isn't generated for an inherited
    // constructor - without this, `ollama` below is silently undefined.
    constructor(ollama: OllamaService) {
        super(ollama);
    }

    protected get modelName(): string {
        return Qwen3EmbeddingOllamaService.modelName;
    }
}

@Injectable()
export class NomicEmbedOllamaService extends OllamaContentEmbedderBase {
    static readonly modelName = 'nomic-embed-text:v1.5';

    // nomic-embed-text is primarily English-trained (Nomic's own model
    // card calls out separate multilingual variants as different models) -
    // conservative default until verified otherwise.
    readonly supportedLanguages: string[] | 'all' = ['en'];

    // nomic-embed-text: 8192-token context.
    readonly maxContextChars = 8192;

    constructor(ollama: OllamaService) {
        super(ollama);
    }

    protected get modelName(): string {
        return NomicEmbedOllamaService.modelName;
    }
}
