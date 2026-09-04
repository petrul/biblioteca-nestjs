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
import { BgeM3OllamaService, NomicEmbedOllamaService, OllamaService, Qwen3EmbeddingOllamaService } from './services/ollama/ollama.service';
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
        const name = conf.milvus_collection_tb_bge_m3_paras;
        const vectorDim = conf.milvus_collection_tb_bge_m3_paras_dim;
        const description = `Textbase paragraph embeddings created by Ollama model "${BgeM3OllamaService.modelName}" `
          + `at ${conf.ollamaServer}; dim=${vectorDim}. Use for multilingual semantic search and nearest-neighbor `
          + `retrieval of Textbase paragraphs. Encode every query with the same model, then search the embedding `
          + `field using the collection's IVF_SQ8 index and L2 metric; resolve matches through the url field.`;
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
    BgeM3OllamaService,
    Qwen3EmbeddingOllamaService,
    NomicEmbedOllamaService,
    {
      // BGE-M3 is multilingual and comparatively compact. The other
      // concrete ContentEmbedder implementations remain injectable by name.
      provide: PROVIDER_EMBEDDER,
      useFactory: (bgeM3: BgeM3OllamaService, logger: LoggerService) => {
        return new RetryingContentEmbedder(bgeM3, logger);
      },
      inject: [BgeM3OllamaService, PROVIDER_LOGGER]
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
