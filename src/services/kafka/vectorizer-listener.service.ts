import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { KafkaService } from './kafka.service';
import { Consumer } from 'kafkajs';
import { VectorizerService } from '../vectorizer.service';
import { BibliotecaClient } from '../biblioteca_client.service';
import { PROVIDER_CONF, PROVIDER_SHARED_CONFIG, SharedTextbaseConfig, VectorizerConfiguration } from 'src/configuration';
import { Util } from 'src/util';
import { describeKafkaError } from './error-details';

@Injectable()
export class VectorizerKafkaListenerService implements OnApplicationShutdown, OnModuleInit {

  consumer: Consumer;

  private readonly log = new Logger(VectorizerKafkaListenerService.name);

  constructor(protected ks: KafkaService,
    protected tbc: BibliotecaClient,
    protected vectorizer: VectorizerService,
    // kafkaGroupId is this worker's own internal consumer identity -- textbase-server
    // never needs to agree on it, so it's a hardcoded application default
    // (KAFKA_GROUP_ID in configuration.ts), not an env var (PROVIDER_CONF).
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
      // Keep these comfortably below the broker's group timeout.  The old
      // three-minute heartbeat caused Kafka to report stale coordinators
      // during normal coordinator changes and made recovery unnecessarily
      // slow.
      sessionTimeout: 30 * 1000,
      heartbeatInterval: 10 * 1000,
    })
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [
        this.sharedConfig.kafka.newOpusImportedTopic,
        this.sharedConfig.kafka.opusRemovedTopic,
      ],
      fromBeginning: true,
    });
    this.log.log(`listening on Kafka topics ${this.sharedConfig.kafka.newOpusImportedTopic} and ${this.sharedConfig.kafka.opusRemovedTopic}`);
    await this.consumer.run({
      eachMessage: (async ({ topic, message, heartbeat }) => {
        // Do not let one transient Textbase/Ollama/Milvus outage terminate the
        // Kafka consumer. Remaining inside eachMessage also prevents KafkaJS
        // from committing the offset until the work has really succeeded.
        for (;;) {
          try {
            await Util.delay(2 * 1000); // for some reason, on new import the opus is not yet ready

            await heartbeat();

            const asJson = message.value.toString();
            var obj = JSON.parse(asJson);
            if (!obj.path) throw new Error(`Kafka event on ${topic} has no opus path: ${asJson}`);

            if (topic === this.sharedConfig.kafka.opusRemovedTopic) {
              // "Vectors are precious": a removed book's vectors are
              // RETAINED, never auto-deleted - the paragraph texts and
              // their embeddings stay valid, only the source is gone.
              // Stale rows will be identified by the planned stale-data
              // reporter and removed only through the explicit, manual
              // POST /api/vector-store/remove-opus operation.
              await heartbeat();
              this.log.log(`opus ${obj.path} removed from the repo - retaining its vectors (removal is manual-only)`, asJson);
              return;
            }

            // No purge of the old vectors before re-vectorizing: the
            // vectorizer reuses everything already stored by sha256
            // (see VectorizerService.vectorize) - unchanged paragraphs are
            // not re-embedded even when the book was renamed (their urls
            // get repointed instead), and nothing is ever dropped.
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
              return heartbeat();
            });
            this.log.log(`done vectorizing for ${obj.id}`, asJson);
            return;
          } catch(err: any) {
            // The generated client throws the raw Response on non-OK. A
            // 404 means the opus is gone for good - a stale Kafka event
            // for a book that was deleted, or whose re-import removed it
            // from under us; a 400 means the server rejects the request
            // for good - observed in production with pre-/author/opus
            // legacy event paths (getByPath throws "path must be of the
            // form /author/opus"). Both are definitive server verdicts
            // that an identical retry can never change, and this loop
            // otherwise wedges the consumer on the same event forever -
            // log once, fall out of eachMessage so KafkaJS commits the
            // offset, and move on. Everything else (embedder down,
            // Milvus down, fetch failed, 5xx) stays retryable.
            if (err && (err.status === 404 || err.status === 400)) {
              this.log.warn(`opus ${obj?.path ?? '<unknown>'} rejected by the server (${err.status}) - skipping Kafka event`,
                message.value.toString());
              return;
            }
            this.log.error(`failed to process opus ${obj?.path ?? '<unknown>'}; retaining the Kafka offset and retrying in 10 seconds — ${await describeKafkaError(err)}`);
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
