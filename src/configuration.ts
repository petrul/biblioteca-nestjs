
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
}

// This worker's own Kafka consumer group id. A stable product convention, not
// a per-environment value: no other service ever needs to agree on it (the
// topic name is what's shared, and that comes from PROVIDER_SHARED_CONFIG --
// see VectorizerKafkaListenerService), so it's hardcoded here rather than externalized
// into the pass store as a KAFKA_GROUP_ID secret.
export const KAFKA_GROUP_ID = 'biblioteca_nestjs';

function parseVectorStoreUrl(raw: string): { baseUrl: string; collection?: string } {
    try {
        const url = new URL(raw);
        const parts = url.pathname.split('/').filter(Boolean);
        const collection = parts.pop();
        url.pathname = parts.length ? '/' + parts.join('/') : '';
        return { baseUrl: url.toString().replace(/\/$/, ''), collection };
    } catch {
        return { baseUrl: raw.replace(/\/+$/, '') };
    }
}

export default (): VectorizerConfiguration => ({
    kafkaServers: required('KAFKA_BROKERS'),
    kafkaGroupId: KAFKA_GROUP_ID,
    ollamaUrl: required('OLLAMA_URL'),
    // The address of whichever vector store is active - one env var for
    // all stores on purpose: switching stores (vectorStoreType) must
    // never require also remembering to switch address variables.
    // VECTORSTORE_URL is the canonical name; the MILVUS_URL fallback
    // keeps every existing deployment/pass-store entry working
    // unchanged until its key is renamed.
    vectorStoreUrl: process.env.VECTORSTORE_URL || required('MILVUS_URL'),
    bibliotecaUrl: required('BIBLIOTECA_EXTERNAL_URL'),
    // Which store backs VectorStore: 'qdrant' (the default - the shared
    // prod instance serves every environment, with per-environment
    // collection names that the server's shared config carries) or
    // 'milvus' (the historic store, still fully supported).
    vectorStoreType: (process.env.VECTOR_STORE || 'qdrant') as VectorizerConfiguration['vectorStoreType'],
    ...(() => {
        const parsed = parseVectorStoreUrl(process.env.VECTORSTORE_URL || required('MILVUS_URL'));
        return { vectorStoreUrl: parsed.baseUrl, qdrantCollection: parsed.collection };
    })(),
    coversApiUrl: process.env.COVERS_API_URL || 'http://localhost:3335',
    // The internal address the S3 client itself connects to (uploads,
    // bucket derivation) - direct host:port, no reverse proxy in the
    // way, so a stale Caddy route can never break writes. Separate from
    // minioPublicUrl below, which the *browser* needs instead.
    minioUrl: process.env.MINIO_URL,
    minioCred: process.env.MINIO_CREDS,
    // The address baked into every coverUrl/image_href this worker
    // persists - a real end-user browser fetches covers directly from
    // this URL, so unlike minioUrl above it must be the public,
    // internet-reachable one (Caddy-fronted). Falls back to minioUrl
    // itself so environments with no separate public endpoint (e.g. an
    // all-internal test setup) keep working unchanged.
    minioPublicUrl: process.env.MINIO_PUBLIC_URL || process.env.MINIO_URL,
});

// Number of paragraphs fetched per page from textbase-server and handed to
// the STS/embedder in one batch. A tuning constant, not something that
// differs between environments - no env var needed.
export const TB_GETPARAS_PAGE_SIZE = 200;

/**
 * The non-secret shared-resource naming convention textbase-server exports
 * from GET /api/admin/config -- see AdminRestController.config() there.
 * biblioteca-nestjs has no configuration of its own for any of this (no env
 * var, no hardcoded default): it fetches this once at startup (see
 * app.module.ts's PROVIDER_SHARED_CONFIG) and uses it directly, so the two
 * services structurally cannot disagree on which Kafka topic, Milvus
 * collection, or embedding model to use.
 */
export interface SharedTextbaseConfig {
    kafka: {
        newOpusImportedTopic: string;
        opusReimportedTopic: string;
        opusRemovedTopic: string;
    };
    milvus: {
        collection: string;
    };
    // Paragraph size window for vectorization - the server's
    // application.properties vectorizer.para.* pair (exported alongside the
    // rest by GET /api/admin/config): paragraphs strictly shorter than
    // minChars are skipped as noise; longer than maxChars they are
    // truncated to maxChars, not dropped.
    paragraph: {
        minChars: number;
        maxChars: number;
    };
    embedder: {
        // canonical Milvus-collection-naming-convention identifier, e.g. "BGE_M3"
        model: string;
        // vector dimension this embedder produces -- required to create/validate
        // the Milvus collection (see MilvusCollection.assertVectorDimensionMatches).
        dimension: number;
        // human-readable summary, used as the Milvus collection's own description.
        description?: string;
        // the actual Ollama model tag to call /api/embed with, e.g. "bge-m3" -
        // absent if textbase-server's active embedder isn't Ollama-backed.
        ollamaModel?: string;
        host?: string;
        port?: number;
    };
}

export interface VectorizerConfiguration {

    //the address of kafka
    kafkaServers: string;

    kafkaGroupId: string;

    // The address of the STS (sentence-transformers) server - RETIRED:
    // not a required env var anymore, and unset in every environment
    // (the sts.service classes stay for the day a per-language STS
    // encoder is needed again, they are never selected today).
    sentenceTransformersServer?: string;

    // the Ollama server backing BGE-M3, Qwen3-Embedding-4B and nomic-embed-text (see services/ollama) -
    // one fixed instance, unlike sentenceTransformersServer/vectorStoreUrl which vary per environment.
    ollamaUrl: string;

    // this is the mini milvus server: mini.local:xxx
    vectorStoreUrl: string;

    // this is the textbase url (i.e. https://textbase.scriptorium.ro)
    bibliotecaUrl: string;

    // which store backs VectorStore: 'qdrant' (the default - see the
    // default-export comment above) or 'milvus' (the historic store).
    vectorStoreType: 'milvus' | 'qdrant';
    /** Collection is encoded as the final path segment of VECTORSTORE_URL. */
    qdrantCollection?: string;
    coversApiUrl: string;
    minioUrl?: string;
    minioCred?: string;
    minioPublicUrl?: string;
}
export const PROVIDER_CONF = Symbol('VectorizerConfiguration');
export const PROVIDER_SHARED_CONFIG = Symbol('SharedTextbaseConfig');

/**
 * typed extension to ConfigService for our properties.
 */
@Injectable()
export class AppConfService implements VectorizerConfiguration {
    constructor (private conf: ConfigService) {}

    get kafkaServers(): string {
        return this.conf.get<string>('kafkaServers');
    }

    get kafkaGroupId(): string {
        return this.conf.get<string>('kafkaGroupId');
    }

    get sentenceTransformersServer(): string | undefined {
        return this.conf.get<string>('sentenceTransformersServer');
    }

    get ollamaUrl(): string {
        return this.conf.get<string>('ollamaUrl');
    }

    get vectorStoreUrl(): string {
        return this.conf.get<string>('vectorStoreUrl');
    }

    get bibliotecaUrl(): string {
        return this.conf.get<string>('bibliotecaUrl');
    }

    get vectorStoreType(): 'milvus' | 'qdrant' {
        return this.conf.get<'milvus' | 'qdrant'>('vectorStoreType');
    }

    get qdrantCollection(): string | undefined { return this.conf.get<string>('qdrantCollection'); }

    get coversApiUrl(): string { return this.conf.get<string>('coversApiUrl'); }
    get minioUrl(): string | undefined { return this.conf.get<string>('minioUrl'); }
    get minioCred(): string | undefined { return this.conf.get<string>('minioCred'); }
    get minioPublicUrl(): string | undefined { return this.conf.get<string>('minioPublicUrl'); }

}
