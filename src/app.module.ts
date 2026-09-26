import { ConsoleLogger, LoggerService, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { VectorizingController } from './vectorizing.controller';
import { VectorizingJobService } from './services/vectorizing_job.service';
import { ProducerService } from './services/kafka/producer.service';
import { KafkaListenerService } from './services/kafka/listener.service';
import { KafkaService } from './services/kafka/kafka.service';
import { VectorizerService } from './services/vectorizer.service';
import { ConfigModule } from '@nestjs/config';
import { BibliotecaClient } from './services/biblioteca_client.service';
import configuration, { AppConfService, PROVIDER_CONF, PROVIDER_SHARED_CONFIG, SharedTextbaseConfig, TB_GETPARAS_PAGE_SIZE, VectorizerConfiguration } from './configuration';
import { MilvusCollection } from './services/milvus/milvuscollection.service';
import { QdrantCollection } from './services/qdrant/qdrantcollection.service';
import { MilvusColVectorStore, QdrantVectorStore, PROVIDER_VECTOR_STORE, VectorStore } from './services/vector_store';
import { ContentEmbedder, PROVIDER_EMBEDDER } from './model/model';
import { AllMiniLmL6V2_StsService, AllMpnetBaseV2_StsService, SentenceTransformersService } from './services/sts/sts.service';
import { BgeM3OllamaService, DynamicOllamaEmbedder, NomicEmbedOllamaService, OllamaService, Qwen3EmbeddingOllamaService } from './services/ollama/ollama.service';
import { RetryingContentEmbedder } from './services/retrying_content_embedder';
import { PROVIDER_LOGGER, retryUntilAvailable } from './util';
import { log } from 'console';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: true,
      load: [ configuration ]
    })
  ],

  controllers: [
    AppController,
    VectorizingController
  ],

  providers: [
      {
        provide: PROVIDER_LOGGER,
        useClass: ConsoleLogger
      },
    {
      provide: PROVIDER_CONF,
      useClass: AppConfService,
    },
    ProducerService,
    KafkaListenerService,
    KafkaService,
    BibliotecaClient,
    VectorizingJobService,
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
      // Whichever vector store VECTOR_STORE selects, behind the
      // VectorStore interface - MilvusColVectorStore over MilvusCollection
      // (the historic default) or QdrantVectorStore over QdrantCollection.
      // Same convention-carrying collection name and data shape either way
      // (the name comes from the server's shared config), so the
      // vectorizer pipeline below never knows which store it writes to.
      provide: PROVIDER_VECTOR_STORE,
      useFactory: async (conf: VectorizerConfiguration, shared: SharedTextbaseConfig, logger: LoggerService) => {
        const name = shared.milvus.collection;
        const vectorDim = shared.embedder.dimension;
        if (!vectorDim) {
          throw new Error(`textbase-server's GET /api/admin/config didn't report an embedder dimension for model '${shared.embedder.model}'.`);
        }
        const description = shared.embedder.description
          ?? `Textbase paragraph embeddings created by embedder "${shared.embedder.model}"; dim=${vectorDim}.`;

        // checked at startup (this factory runs during app bootstrap, before
        // anything depending on the store - including the Kafka listener -
        // is constructed): wait and retry instead of crashing the whole app
        // the moment the store happens to be unreachable.
        if (conf.vectorStoreType === 'qdrant') {
          // The one VECTORSTORE_URL addresses whichever store is active -
          // here that is the shared qdrant instance (one instance serves
          // every environment; the collection name above carries the
          // per-environment prefix from the server's shared config).
          const col = new QdrantCollection(name, conf.vectorStoreUrl, vectorDim, description);
          await retryUntilAvailable(() => col.createAndLoadIfNotExists(), logger, 'Qdrant');
          // A freshly-created collection is trivially self-consistent (create()
          // uses this same vectorDim) - this only ever catches a genuine
          // pre-existing mismatch (stale collection, config typo), and does so
          // loudly at startup instead of at the first confusing insert/search
          // failure.
          await col.assertVectorDimensionMatches(vectorDim);
          return new QdrantVectorStore(col);
        }

        const col = new MilvusCollection(name, conf, vectorDim, description);
        await retryUntilAvailable(() => col.createAndLoadIfNotExists(), logger, 'Milvus');
        await col.assertVectorDimensionMatches(vectorDim);
        return new MilvusColVectorStore(col);
      },
      inject: [PROVIDER_CONF, PROVIDER_SHARED_CONFIG, PROVIDER_LOGGER]
    },
    SentenceTransformersService,
    AllMpnetBaseV2_StsService,
    AllMiniLmL6V2_StsService,
    OllamaService,
    BgeM3OllamaService,
    Qwen3EmbeddingOllamaService,
    NomicEmbedOllamaService,
    {
      // Whichever model textbase-server's shared config reports as active
      // (currently BGE-M3) -- wrapped in RetryingContentEmbedder so a
      // temporarily-unreachable Ollama server makes vectorize() wait and
      // retry instead of failing one page at a time for nothing. The other
      // concrete ContentEmbedder implementations above remain injectable
      // by name for explicit/manual use.
      provide: PROVIDER_EMBEDDER,
      useFactory: (shared: SharedTextbaseConfig, ollama: OllamaService, logger: LoggerService) => {
        if (!shared.embedder.ollamaModel) {
          throw new Error(`textbase-server's active embedder ('${shared.embedder.model}') isn't Ollama-backed -- biblioteca-nestjs only supports Ollama-backed embedders.`);
        }
        const embedder = new DynamicOllamaEmbedder(ollama, shared.embedder.ollamaModel);
        return new RetryingContentEmbedder(embedder, logger);
      },
      inject: [PROVIDER_SHARED_CONFIG, OllamaService, PROVIDER_LOGGER]
    },
    {
      provide: VectorizerService,
      useFactory: (tbc: BibliotecaClient, embedder: ContentEmbedder , vecstore: VectorStore,
        conf: VectorizerConfiguration, shared: SharedTextbaseConfig, logger: LoggerService ) => {
        log(conf);
        return new VectorizerService(tbc, embedder, vecstore, logger, shared, TB_GETPARAS_PAGE_SIZE);
      },
      inject: [BibliotecaClient, PROVIDER_EMBEDDER, PROVIDER_VECTOR_STORE, PROVIDER_CONF, PROVIDER_SHARED_CONFIG, PROVIDER_LOGGER]
    },
    
  ],
})
export class AppModule { }
