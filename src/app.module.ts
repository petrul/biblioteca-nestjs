import { ConsoleLogger, LoggerService, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ProducerService } from './services/kafka/producer.service';
import { KafkaListenerService } from './services/kafka/listener.service';
import { KafkaService } from './services/kafka/kafka.service';
import { VectorizerService } from './services/vectorizer.service';
import { ConfigModule } from '@nestjs/config';
import { TextbaseClient } from './services/textbase_client.service';
import configuration, { AppConfService, PROVIDER_CONF, PROVIDER_SHARED_CONFIG, SharedTextbaseConfig, VectorizerConfiguration } from './configuration';
import { MilvusCollection } from './services/milvus/milvuscollection.service';
import { MilvusColVectorStore } from './services/vector_store';
import { ContentEmbedder, PROVIDER_EMBEDDER } from './model/model';
import { AllMpnetBaseV2_StsService, SentenceTransformersService } from './services/sts/sts.service';
import { DynamicOllamaEmbedder, NomicEmbedOllamaService, OllamaService, Qwen3EmbeddingOllamaService } from './services/ollama/ollama.service';
import { RetryingContentEmbedder } from './services/retrying_content_embedder';
import { PROVIDER_LOGGER, retryUntilAvailable } from './util';
import { log } from 'console';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [ configuration ]
    })
  ],

  controllers: [
    AppController
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
    TextbaseClient,
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
      useFactory: async (tbc: TextbaseClient, logger: LoggerService) => {
        return await retryUntilAvailable(() => tbc.getConfig(), logger, 'textbase-server /api/admin/config');
      },
      inject: [TextbaseClient, PROVIDER_LOGGER]
    },
    {
      provide: MilvusCollection,
      useFactory: async (conf: VectorizerConfiguration, shared: SharedTextbaseConfig, logger: LoggerService) => {
        const name = shared.milvus.collection;
        const vectorDim = MilvusCollection.DIM_BY_MODEL[shared.embedder.model];
        if (!vectorDim) {
          throw new Error(`No known vector dimension for embedder model '${shared.embedder.model}' reported by textbase-server -- add it to MilvusCollection.DIM_BY_MODEL.`);
        }
        const col = new MilvusCollection(name, conf, vectorDim);
        // checked at startup (this factory runs during app bootstrap, before
        // anything depending on MilvusCollection - including the Kafka
        // listener - is constructed): wait and retry instead of crashing
        // the whole app the moment Milvus happens to be unreachable.
        await retryUntilAvailable(() => col.createAndLoadIfNotExists(), logger, 'Milvus');
        return col;
      },
      inject: [PROVIDER_CONF, PROVIDER_SHARED_CONFIG, PROVIDER_LOGGER]
    },
    SentenceTransformersService,
    AllMpnetBaseV2_StsService,
    OllamaService,
    Qwen3EmbeddingOllamaService,
    NomicEmbedOllamaService,
    {
      // Whichever model textbase-server's shared config reports (currently
      // Qwen3-Embedding-4B) -- wrapped in RetryingContentEmbedder so a
      // temporarily-unreachable Ollama server makes vectorize() wait and
      // retry instead of failing one page at a time for nothing.
      provide: PROVIDER_EMBEDDER,
      useFactory: (shared: SharedTextbaseConfig, ollama: OllamaService, logger: LoggerService) => {
        if (!shared.embedder.ollamaModel) {
          throw new Error(`textbase-server's active embedder ('${shared.embedder.model}') isn't Ollama-backed -- textbase-nestjs only supports Ollama-backed embedders.`);
        }
        const embedder = new DynamicOllamaEmbedder(ollama, shared.embedder.ollamaModel);
        return new RetryingContentEmbedder(embedder, logger);
      },
      inject: [PROVIDER_SHARED_CONFIG, OllamaService, PROVIDER_LOGGER]
    },
    MilvusColVectorStore,
    {
      provide: VectorizerService,
      useFactory: (tbc: TextbaseClient, embedder: ContentEmbedder , vecstore: MilvusColVectorStore, 
        conf: VectorizerConfiguration, logger: LoggerService ) => {
        log(conf);
        const pageSize = conf.tb_getParas_pageSize;
        return new VectorizerService(tbc, embedder, vecstore, logger, pageSize);
      },
      inject: [TextbaseClient, PROVIDER_EMBEDDER, MilvusColVectorStore, PROVIDER_CONF, PROVIDER_LOGGER]
    },
    
  ],
})
export class AppModule { }
