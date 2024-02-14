import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { KafkaService } from './kafka.service';
import { Consumer, ConsumerRunConfig, ConsumerSubscribeTopics } from 'kafkajs';
import { partition } from 'rxjs';

@Injectable()
export class ListenerService implements OnApplicationShutdown, OnModuleInit {

  consumer : Consumer;

  constructor(protected ks: KafkaService) {}
  
  async onModuleInit() {
    this.consumer = this.ks.kafka.consumer({
      groupId: 'nestjs-client',
    })
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: 'tb_newOpusImportedTopic'
    });
    await this.consumer.run({
      eachMessage: (async ({topic, partition, message}) => {
        // const json = JSON.parse(message.value.toJSON())
        const obj = JSON.parse(message.value.toString())
        console.log(obj); 
      }),
    });    
  }

  onApplicationShutdown(_signal?: string) {
    this.consumer.disconnect();    
  }

}
