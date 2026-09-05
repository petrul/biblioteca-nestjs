import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { KafkaService } from './kafka.service';
import { Consumer } from 'kafkajs';
import { VectorizerService } from '../vectorizer.service';
import { TextbaseClient } from '../textbase_client.service';
import { PROVIDER_CONF, PROVIDER_SHARED_CONFIG, SharedTextbaseConfig, VectorizerConfiguration } from 'src/configuration';
import { Util } from 'src/util';

@Injectable()
export class KafkaListenerService implements OnApplicationShutdown, OnModuleInit {

  consumer: Consumer;

  private readonly log = new Logger(KafkaListenerService.name);

  constructor(protected ks: KafkaService,
    protected tbc: TextbaseClient,
    protected vectorizer: VectorizerService,
    // kafkaGroupId is nestjs's own internal consumer identity -- textbase-server
    // never needs to agree on it, so it stays local/env-driven (PROVIDER_CONF).
    // The topic name it subscribes to DOES need cross-service agreement, so
    // that comes from PROVIDER_SHARED_CONFIG instead (see configuration.ts).
    @Inject(PROVIDER_CONF) protected conf: VectorizerConfiguration,
    @Inject(PROVIDER_SHARED_CONFIG) protected sharedConfig: SharedTextbaseConfig) { }

  async onModuleInit() {
    await this.initKafkaListener();
  }

  async initKafkaListener() {
    this.consumer = this.ks.kafka.consumer({
      groupId: this.conf.kafkaGroupId,
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
      topic: this.sharedConfig.kafka.newOpusImportedTopic,
      fromBeginning: true,
    });
    await this.consumer.run({
      eachMessage: (async ({ message, heartbeat }) => {
        // Do not let one transient Textbase/Ollama/Milvus outage terminate the
        // Kafka consumer. Remaining inside eachMessage also prevents KafkaJS
        // from committing the offset until the work has really succeeded.
        for (;;) {
          try {
            await Util.delay(2 * 1000); // for some reason, on new import the opus is not yet ready

            await heartbeat();

            const asJson = message.value.toString();
            var obj = JSON.parse(asJson);
            if (obj.path) {
              // some older kafka messages have the id already obsolete.
              // so get the div again just to make sure.
              obj = await this.tbc.getElemByPath(obj.path);
            }
            await heartbeat();

            this.log.log(obj);
            const opId = obj.id;
            this.log.log(`starting vectorizing for ${obj.id}`, asJson);
            await this.vectorizer.vectorize(opId, () => {
              this.log.debug('kafka heartbeat');
              return heartbeat();
            });
            this.log.log(`done vectorizing for ${obj.id}`, asJson);
            return;
          } catch(err: any) {
            this.log.error('failed to vectorize; retaining the Kafka offset and retrying in 10 seconds', err);
            await Util.delay(10 * 1000);
            await heartbeat();
          }
        }
      }),
    });
  }

  onApplicationShutdown(_signal?: string) {
    this.consumer.disconnect();
  }

}
