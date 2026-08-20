import { ConsoleLogger, LoggerService, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ProducerService } from './services/kafka/producer.service';
import { KafkaListenerService } from './services/kafka/listener.service';
import { KafkaService } from './services/kafka/kafka.service';
import { VectorizerService } from './services/vectorizer.service';
import { ConfigModule } from '@nestjs/config';
import { TextbaseClient } from './services/textbase_client.service';
import configuration, { AppConfService, PROVIDER_CONF, VectorizerConfiguration } from './configuration';
import { MilvusCollection } from './services/milvus/milvuscollection.service';
import { MilvusColVectorStore } from './services/vector_store';
import { ContentEmbedder, PROVIDER_EMBEDDER } from './model/model';
import { AllMpnetBaseV2_StsService, SentenceTransformersService } from './services/sts/sts.service';
import { NomicEmbedOllamaService, OllamaService, Qwen3EmbeddingOllamaService } from './services/ollama/ollama.service';
import { RetryingContentEmbedder } from './services/retrying_content_embedder';
import { PROVIDER_LOGGER, retryUntilAvailable } from './util';
import { log } from 'console';

@Module({
  imports: [
    ConfigModule.forRoot({
      ignoreEnvFile: true,
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
      provide: MilvusCollection,
      useFactory: async (conf: VectorizerConfiguration, logger: LoggerService) => {
        // qwen3-embedding replaced all-mpnet-base-v2 as the default embedder
        // below, so this now targets its own (differently-dimensioned)
        // collection - see VectorizerConfiguration's doc comments.
        const name = conf.milvus_collection_tb_qwen3_embedding_4b_paras;
        const vectorDim = conf.milvus_collection_tb_qwen3_embedding_4b_paras_dim;
        const col = new MilvusCollection(name, conf, vectorDim);
        // checked at startup (this factory runs during app bootstrap, before
        // anything depending on MilvusCollection - including the Kafka
        // listener - is constructed): wait and retry instead of crashing
        // the whole app the moment Milvus happens to be unreachable.
        await retryUntilAvailable(() => col.createAndLoadIfNotExists(), logger, 'Milvus');
        return col;
      },
      inject: [PROVIDER_CONF, PROVIDER_LOGGER]
    },
    SentenceTransformersService,
    AllMpnetBaseV2_StsService,
    OllamaService,
    Qwen3EmbeddingOllamaService,
    NomicEmbedOllamaService,
    {
      // Qwen3-Embedding-4B (via Ollama) is now the default, replacing
      // AllMpnetBaseV2_StsService (still registered above, still usable
      // under its own name) - wrapped in RetryingContentEmbedder so a
      // temporarily-unreachable Ollama server makes vectorize() wait and
      // retry instead of failing one page at a time for nothing.
      provide: PROVIDER_EMBEDDER,
      useFactory: (qwen: Qwen3EmbeddingOllamaService, logger: LoggerService) => {
        return new RetryingContentEmbedder(qwen, logger);
      },
      inject: [Qwen3EmbeddingOllamaService, PROVIDER_LOGGER]
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
