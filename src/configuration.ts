
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
// see KafkaListenerService), so it's hardcoded here rather than externalized
// into the pass store as a KAFKA_GROUP_ID secret.
export const KAFKA_GROUP_ID = 'biblioteca_nestjs';

export default (): VectorizerConfiguration => ({
    kafkaServers: required('KAFKA_BROKERS'),
    kafkaGroupId: KAFKA_GROUP_ID,
    sentenceTransformersServer: required('STS_SERVER'),
    ollamaServer: required('OLLAMA_SERVER'),
    miniMilvus: required('MILVUS_URL'),
    bibliotecaUrl: required('BIBLIOTECA_EXTERNAL_URL'),
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

    // this is the address of the STS server, i.e. mini.local:xxx
    sentenceTransformersServer: string;

    // the Ollama server backing BGE-M3, Qwen3-Embedding-4B and nomic-embed-text (see services/ollama) -
    // one fixed instance, unlike sentenceTransformersServer/miniMilvus which vary per environment.
    ollamaServer: string;

    // this is the mini milvus server: mini.local:xxx
    miniMilvus: string;

    // this is the textbase url (i.e. https://textbase.scriptorium.ro)
    bibliotecaUrl: string;
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

    get sentenceTransformersServer(): string {
        return this.conf.get<string>('sentenceTransformersServer');
    }

    get ollamaServer(): string {
        return this.conf.get<string>('ollamaServer');
    }

    get miniMilvus(): string {
        return this.conf.get<string>('miniMilvus');
    }

    get bibliotecaUrl(): string {
        return this.conf.get<string>('bibliotecaUrl');
    }
}
