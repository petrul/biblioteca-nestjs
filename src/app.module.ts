import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ProducerService } from './services/kafka/producer.service';
import { ListenerService } from './services/kafka/listener.service';
import { KafkaService } from './services/kafka/kafka.service';
import { IndexerService } from './services/indexer.service';
import { ConfigModule } from '@nestjs/config';
import { TextbaseClient } from './services/textbase_client.service';
import configuration, { AppConfService } from './configuration';

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
    AppConfService,
    ProducerService,
    ListenerService,
    KafkaService,
    IndexerService,
    TextbaseClient,    
  ],
})
export class AppModule { }
