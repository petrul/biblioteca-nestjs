import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ProducerService } from './services/kafka/producer.service';
import { ListenerService } from './services/kafka/listener.service';
import { KafkaService } from './services/kafka/kafka.service';
import { VectorizerService } from './services/vectorizer.service';
import { ConfigModule } from '@nestjs/config';
import { TextbaseClient } from './services/textbase_client.service';
import configuration, { AppConfService, PROVIDER_CONF } from './configuration';

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
      provide: PROVIDER_CONF,
      useClass: AppConfService,
    },
    
    ProducerService,
    ListenerService,
    KafkaService,
    VectorizerService,
    TextbaseClient,    
  ],
})
export class AppModule { }
