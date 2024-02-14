import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProducerService } from './producer.service';
import { ListenerService } from './listener.service';
import { KafkaService } from './kafka.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, ProducerService, ListenerService, KafkaService],
})
export class AppModule {}
