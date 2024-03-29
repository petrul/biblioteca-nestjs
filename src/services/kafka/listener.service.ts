import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { KafkaService } from './kafka.service';
import { Consumer } from 'kafkajs';
import { VectorizerService } from '../vectorizer.service';
import { TextbaseClient } from '../textbase_client.service';
import { Util } from 'src/util';

@Injectable()
export class KafkaListenerService implements OnApplicationShutdown, OnModuleInit {

  consumer: Consumer;
  
  private readonly log = new Logger(KafkaListenerService.name);

  constructor(protected ks: KafkaService,
    protected tbc: TextbaseClient, 
    protected vectorizer: VectorizerService) { }

  async onModuleInit() {
    await this.initKafkaListener();
  }

  async initKafkaListener() {
    this.consumer = this.ks.kafka.consumer({
      groupId: 'textbase-vectorizer', 
      /**
       * The timeout used to detect client failures when using Kafka’s group management facility. 
       * The client sends periodic heartbeats to indicate its liveness to the broker. 
       * If no heartbeats are received by the broker before the expiration of this session timeout, 
       * then the broker will remove this client from the group and initiate a rebalance. 
       */
      sessionTimeout:  30 * 60 * 1000, // 30 min, group.max.session.timeout.ms configured on the broker
      heartbeatInterval: 3 * 60 * 1000, // every 3 minutes, you should send a heartbeat
    })
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: 'tb_newOpusImportedTopic', 
      fromBeginning: true,
    });
    await this.consumer.run({
      eachMessage: (async ({ topic, partition, message, heartbeat, pause }) => {
        try {
          await Util.delay(2 * 1000); // for some reason, on new import the opus is not yet ready

          heartbeat();

          const asJson = message.value.toString();
          var obj = JSON.parse(message.value.toString())
          if (obj.path) {
            // some older kafka messages have the id already obsolete.
            // so get the div again just to make sure.
            obj = await this.tbc.getElemByPath(obj.path);
          }
          heartbeat();
          
          this.log.log(obj);
          const opId = obj.id;
          this.log.log(`starting vectorizing for ${obj.id}`, asJson);
          await this.vectorizer.vectorize(opId, () => { 
            this.log.debug('kafka heartbeat');
            return heartbeat(); }
          );
          this.log.log(`done vectorizing for ${obj.id}`, asJson);
        } catch(err: any) {
          // ignore so that kafka message does not go back 
          this.log.error('will ignore exception', err);
        }
      }),
    });
  }

  onApplicationShutdown(_signal?: string) {
    this.consumer.disconnect();
  }

}
