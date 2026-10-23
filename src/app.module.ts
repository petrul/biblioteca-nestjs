import { ConsoleLogger, LoggerService, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { VectorizingController } from './vectorizing.controller';
import { VectorizingJobService } from './services/vectorizing_job.service';
import { ProducerService } from './services/kafka/producer.service';
import { VectorizerKafkaListenerService } from './services/kafka/vectorizer-listener.service';
import { AuthorEnrichmentKafkaListenerService } from './services/kafka/author-enrichment-listener.service';
import { WorkEnrichmentKafkaListenerService } from './services/kafka/work-enrichment-listener.service';
import { KafkaService } from './services/kafka/kafka.service';
import { VectorizerService } from './services/vectorizer.service';
import { ConfigModule } from '@nestjs/config';
import { BibliotecaClient } from './services/biblioteca_client.service';
import configuration, { AppConfService, PROVIDER_CONF, PROVIDER_SHARED_CONFIG, SharedTextbaseConfig, TB_GETPARAS_PAGE_SIZE, VectorizerConfiguration } from './configuration';
import { QdrantVectorStore } from './ragtime/adapters/qdrant.vector-store';
import { OllamaChatModel } from './ragtime/adapters/ollama.chat-model';
import { DEFAULT_GENERATION_MODEL } from './ragtime/adapters/ollama.model-finder';
import { OllamaEmbedder } from './ragtime/adapters/ollama.embedder';
import { Embedder } from './ragtime/core';
import { BIBLIOTECA_QDRANT_TUNING, bibliotecaCollectionSpec, BibliotecaPayload } from './biblioteca-rag/biblioteca.source';
import { BibliotecaVectorCollection, PROVIDER_CHAT_MODEL, PROVIDER_EMBEDDER, PROVIDER_VECTOR_COLLECTION } from './biblioteca-rag/ragtime.providers';
import { RagService } from './biblioteca-rag/rag.service';
import { RagController } from './biblioteca-rag/rag.controller';
import { AllMiniLmL6V2_StsService, AllMpnetBaseV2_StsService, SentenceTransformersService } from './services/sts/sts.service';
import { RetryingEmbedder } from './services/retrying_embedder';
import { PROVIDER_LOGGER, retryUntilAvailable } from './util';
import { log } from 'console';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health/health.controller';
import { UpstreamHealthIndicator } from './health/upstream-health.indicator';
import { EnrichmentService } from './services/enrichment.service';
import { EnrichmentAdminService } from './services/enrichment-admin.service';
import { EnrichmentAdminController } from './enrichment-admin.controller';
import { CoverAdminController } from './cover-admin.controller';
import { CoverWorkController } from './cover-work.controller';
import { CoverEnrichmentService } from './services/cover-enrichment.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: true,
      load: [ configuration ]
    }),
    TerminusModule
  ],

  controllers: [
    AppController,
    VectorizingController,
    EnrichmentAdminController,
    CoverAdminController, CoverWorkController,
    RagController,
    HealthController
  ],

  providers: [
      UpstreamHealthIndicator,
      {
        provide: PROVIDER_LOGGER,
        useClass: ConsoleLogger
      },
    {
      provide: PROVIDER_CONF,
      useClass: AppConfService,
    },
    ProducerService,
    VectorizerKafkaListenerService,
    AuthorEnrichmentKafkaListenerService,
    WorkEnrichmentKafkaListenerService,
    KafkaService,
    EnrichmentService,
    EnrichmentAdminService,
    CoverEnrichmentService,
    BibliotecaClient,
    VectorizingJobService,
    RagService,
    {
      // The non-secret shared-resource naming convention (Kafka topics,
      // Milvus collection, embedding model) textbase-server is the source
      // of truth for -- fetched once at bootstrap and reused by every
      // provider below that needs it, instead of each independently
      // hardcoding/env-configuring its own opinion (see
      // SharedTextbaseConfig's doc comment for why). Wrapped in
      // retryUntilAvailable, same as the Milvus/embedder providers below,
      // since this also runs during app bootstrap before textbase-server
      // is necessarily up yet.
      provide: PROVIDER_SHARED_CONFIG,
      useFactory: async (tbc: BibliotecaClient, logger: LoggerService) => {
        return await retryUntilAvailable(() => tbc.getConfig(), logger, 'biblioteca-server /api/admin/config');
      },
      inject: [BibliotecaClient, PROVIDER_LOGGER]
    },
    {
      // The paragraph vectors: ragtime's QdrantVectorStore over the
      // convention-carrying collection name from the server's shared config
      // (one Qdrant instance serves every environment; the name carries the
      // per-environment prefix), unless VECTORSTORE_URL names a collection.
      // Point ids and payload ({sha256, url, opus_path}) are the layout
      // biblioteca-server's own vector search reads.
      provide: PROVIDER_VECTOR_COLLECTION,
      useFactory: async (conf: VectorizerConfiguration, shared: SharedTextbaseConfig, logger: LoggerService) => {
        if (conf.vectorStoreType !== 'qdrant') {
          throw new Error(`VECTOR_STORE=${conf.vectorStoreType} is not supported: the vectors live in Qdrant (Milvus is retired).`);
        }
        const name = conf.qdrantCollection || shared.milvus.collection;
        if (conf.qdrantCollection) logger.log('Qdrant collection override: ' + name);
        const vectorDim = shared.embedder.dimension;
        if (!vectorDim) {
          throw new Error(`textbase-server's GET /api/admin/config didn't report an embedder dimension for model '${shared.embedder.model}'.`);
        }
        const store = new QdrantVectorStore({
          url: conf.vectorStoreUrl, vectorName: 'embedding', idField: BibliotecaPayload.SHA256, tuning: BIBLIOTECA_QDRANT_TUNING,
        });
        const vectors = new BibliotecaVectorCollection(store, store, name, bibliotecaCollectionSpec(vectorDim));

        // checked at startup (this factory runs during app bootstrap, before
        // anything depending on the store - including the Kafka listener -
        // is constructed): wait and retry instead of crashing the whole app
        // the moment the store happens to be unreachable.
        await retryUntilAvailable(() => vectors.ensure(), logger, 'Qdrant');
        // A freshly-created collection is trivially self-consistent - this only
        // ever catches a genuine pre-existing mismatch (stale collection,
        // config typo), and does so loudly at startup instead of at the first
        // confusing insert/search failure.
        await vectors.assertCompatible();
        return vectors;
      },
      inject: [PROVIDER_CONF, PROVIDER_SHARED_CONFIG, PROVIDER_LOGGER]
    },
    SentenceTransformersService,
    AllMpnetBaseV2_StsService,
    AllMiniLmL6V2_StsService,
    {
      // Whichever model textbase-server's shared config reports as active
      // (currently BGE-M3) -- wrapped in RetryingEmbedder so a
      // temporarily-unreachable Ollama server makes vectorize() and the
      // searches wait and retry instead of failing for nothing. The other
      // concrete Embedder implementations above remain injectable by name
      // for explicit/manual use.
      provide: PROVIDER_EMBEDDER,
      useFactory: (shared: SharedTextbaseConfig, conf: VectorizerConfiguration, logger: LoggerService) => {
        if (!shared.embedder.ollamaModel) {
          throw new Error(`textbase-server's active embedder ('${shared.embedder.model}') isn't Ollama-backed -- biblioteca-nestjs only supports Ollama-backed embedders.`);
        }
        const model = shared.embedder.ollamaModel;
        const embedder = new OllamaEmbedder({
          url: conf.ollamaUrl,
          model,
          dimension: shared.embedder.dimension,
          // bge-m3 (the server's default) and qwen3-embedding are both
          // genuinely multilingual; an English-only model would need its
          // languages here.
          supportedLanguages: 'all',
          // bge-m3: 8192-token context at a conservative ~2 chars/token; the
          // server's paragraph.maxChars (3000) is the tighter bound anyway.
          maxInputChars: 16384,
          // bge-m3 is the embedding model every client of the shared Ollama
          // keeps loaded for good, next to one generating model on the GPU:
          // a call without keep_alive would reset that and unload it later.
          keepAlive: model.startsWith('bge-m3') ? -1 : undefined,
        });
        return new RetryingEmbedder(embedder, logger);
      },
      inject: [PROVIDER_SHARED_CONFIG, PROVIDER_CONF, PROVIDER_LOGGER]
    },
    {
      // RAG answers come from the shared Ollama too: the generating model
      // already loaded next to the pinned bge-m3 (found lazily, on the first
      // question), else qwen3.5:9b.
      provide: PROVIDER_CHAT_MODEL,
      useFactory: (conf: VectorizerConfiguration) => new OllamaChatModel({ url: conf.ollamaUrl, defaultModel: DEFAULT_GENERATION_MODEL }),
      inject: [PROVIDER_CONF]
    },
    {
      provide: VectorizerService,
      useFactory: (tbc: BibliotecaClient, embedder: Embedder, vectors: BibliotecaVectorCollection,
        conf: VectorizerConfiguration, shared: SharedTextbaseConfig ) => {
        log(conf);
        return new VectorizerService(tbc, embedder, vectors, shared, TB_GETPARAS_PAGE_SIZE);
      },
      inject: [BibliotecaClient, PROVIDER_EMBEDDER, PROVIDER_VECTOR_COLLECTION, PROVIDER_CONF, PROVIDER_SHARED_CONFIG, PROVIDER_LOGGER]
    },
    
  ],
})
export class AppModule { }
