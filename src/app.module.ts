import { ConsoleLogger, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ProducerService } from './services/kafka/producer.service';
import { ListenerService } from './services/kafka/listener.service';
import { KafkaService } from './services/kafka/kafka.service';
import { VectorizerService } from './services/vectorizer.service';
import { ConfigModule } from '@nestjs/config';
import { TextbaseClient } from './services/textbase_client.service';
import configuration, { AppConfService, PROVIDER_CONF, VectorizerConfiguration } from './configuration';
import { MilvusCollection } from './services/milvus/milvuscollection.service';
import { MilvusColVectorStore } from './services/vector_store';
import { ContentEmbedder, PROVIDER_EMBEDDER } from './model/model';
import { AllMpnetBaseV2_StsService, SentenceTransformersService } from './services/sts/sts.service';
import { PROVIDER_LOGGER } from './util';

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
    ListenerService,
    KafkaService,
    TextbaseClient,
    {
      provide: MilvusCollection,
      useFactory: (conf: VectorizerConfiguration) => {
        const name = conf.milvus_collection_tb_all_mpnet_base_v2_paras;
        return new MilvusCollection(name, conf);
      },
      inject: [PROVIDER_CONF]
    },
    SentenceTransformersService,
    {
      provide: PROVIDER_EMBEDDER,
      useClass: AllMpnetBaseV2_StsService
    },
    MilvusColVectorStore,
    {
      provide: VectorizerService,
      useFactory: (tbc: TextbaseClient, embedder: ContentEmbedder , vecstore: MilvusColVectorStore, conf: VectorizerConfiguration ) => {
        return new VectorizerService(tbc, embedder, vecstore, conf.tb_getParas_pageSize);
      },
      inject: [TextbaseClient, PROVIDER_EMBEDDER, MilvusColVectorStore]
    },
    
  ],
})
export class AppModule { }
