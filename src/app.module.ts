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
import { AllMiniLmL6V2_StsService, AllMpnetBaseV2_StsService, SentenceTransformersService } from './services/sts/sts.service';
import { NomicEmbedOllamaService, OllamaService, Qwen3EmbeddingOllamaService } from './services/ollama/ollama.service';
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
        // all-MiniLM-L6-v2 (via STS) replaced Qwen3-Embedding-4B as the
        // default embedder below, so this now targets its own
        // (differently-dimensioned) collection - see
        // VectorizerConfiguration's doc comments.
        const name = conf.milvus_collection_textbase_sts_all_minilm_l6_v2_paras;
        const vectorDim = conf.milvus_collection_textbase_sts_all_minilm_l6_v2_paras_dim;
        const description = `STS (sentence-transformers) encoder "${AllMiniLmL6V2_StsService.modelName}" `
          + `at ${conf.sentenceTransformersServer}, dim=${vectorDim}`;
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
      inject: [PROVIDER_CONF, PROVIDER_LOGGER]
    },
    SentenceTransformersService,
    AllMpnetBaseV2_StsService,
    AllMiniLmL6V2_StsService,
    OllamaService,
    Qwen3EmbeddingOllamaService,
    NomicEmbedOllamaService,
    {
      // all-MiniLM-L6-v2 (via STS) is the default for now, replacing
      // Qwen3-Embedding-4B (still registered above, still usable under its
      // own name) - wrapped in RetryingContentEmbedder so a
      // temporarily-unreachable STS server makes vectorize() wait and
      // retry instead of failing one page at a time for nothing.
      provide: PROVIDER_EMBEDDER,
      useFactory: (sts: AllMiniLmL6V2_StsService, logger: LoggerService) => {
        return new RetryingContentEmbedder(sts, logger);
      },
      inject: [AllMiniLmL6V2_StsService, PROVIDER_LOGGER]
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
