import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { KafkaService } from './kafka.service';
import { Consumer } from 'kafkajs';
import { VectorizerService } from '../vectorizer.service';
import { log } from 'console';
import { TextbaseClient } from '../textbase_client.service';
import { Util } from 'src/util';

@Injectable()
export class ListenerService implements OnApplicationShutdown, OnModuleInit {

  consumer: Consumer;

  constructor(protected ks: KafkaService,
    protected tbc: TextbaseClient, 
    protected vectorizer: VectorizerService) { }

  async onModuleInit() {
    await this.initKafkaListener();
  }

  async initKafkaListener() {
    this.consumer = this.ks.kafka.consumer({
      groupId: 'textbase-vectorizer',
    })
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: 'tb_newOpusImportedTopic', 
      fromBeginning: true,
    });
    await this.consumer.run({
      eachMessage: (async ({ topic, partition, message }) => {
        try {
          await Util.delay(2 * 1000); // for some reason, on new import the opus is not yet ready
          const asJson = message.value.toString();
          var obj = JSON.parse(message.value.toString())
          if (obj.path) {
            // some older kafka messages have the id already obsolete.
            // so get the div again just to make sure.
            obj = await this.tbc.getElemByPath(obj.path);
          }
          console.log(obj);
          const opId = obj.id;
          log(`starting vectorizing for ${obj.id}`, asJson);
          await this.vectorizer.vectorize(opId);
          log(`done vectorizing for ${obj.id}`, asJson);  
        } catch(err: any) {
          // ignore so that kafka message does not go back 
          console.error('will ignore exception', err);
        }
      }),
    });
  }

  onApplicationShutdown(_signal?: string) {
    this.consumer.disconnect();
  }

}
