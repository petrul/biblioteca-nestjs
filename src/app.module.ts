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
import { MilvusColVectorStore } from './services/vector_store';
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
      provide: MilvusCollection,
      useFactory: async (conf: VectorizerConfiguration, shared: SharedTextbaseConfig, logger: LoggerService) => {
        const name = shared.milvus.collection;
        const vectorDim = shared.embedder.dimension;
        if (!vectorDim) {
          throw new Error(`textbase-server's GET /api/admin/config didn't report an embedder dimension for model '${shared.embedder.model}'.`);
        }
        const description = shared.embedder.description
          ?? `Textbase paragraph embeddings created by embedder "${shared.embedder.model}"; dim=${vectorDim}.`;
        const col = new MilvusCollection(name, conf, vectorDim, description);
        // checked at startup (this factory runs during app bootstrap, before
        // anything depending on MilvusCollection - including the Kafka
        // listener - is constructed): wait and retry instead of crashing
        // the whole app the moment Milvus happens to be unreachable.
        await retryUntilAvailable(() => col.createAndLoadIfNotExists(), logger, 'Milvus');
        // A freshly-created collection is trivially self-consistent (create()
        // uses this same vectorDim) - this only ever catches a genuine
        // pre-existing mismatch (stale collection, config typo), and does so
        // loudly at startup instead of at the first confusing insert/search
        // failure.
        await col.assertVectorDimensionMatches(vectorDim);
        return col;
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
    MilvusColVectorStore,
    {
      provide: VectorizerService,
      useFactory: (tbc: BibliotecaClient, embedder: ContentEmbedder , vecstore: MilvusColVectorStore, 
        conf: VectorizerConfiguration, logger: LoggerService ) => {
        log(conf);
        return new VectorizerService(tbc, embedder, vecstore, logger, TB_GETPARAS_PAGE_SIZE);
      },
      inject: [BibliotecaClient, PROVIDER_EMBEDDER, MilvusColVectorStore, PROVIDER_CONF, PROVIDER_LOGGER]
    },
    
  ],
})
export class AppModule { }
