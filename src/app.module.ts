import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProducerService } from './producer.service';
import { ListenerService } from './services/kafka/listener.service';
import { KafkaService } from './services/kafka/kafka.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, ProducerService, ListenerService, KafkaService],
})
export class AppModule {}
