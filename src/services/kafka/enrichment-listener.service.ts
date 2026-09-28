import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { KafkaService } from './kafka.service';
import { Consumer } from 'kafkajs';
import { BibliotecaClient } from '../biblioteca_client.service';
import { EnrichmentService } from '../enrichment.service';
import { PROVIDER_SHARED_CONFIG, SharedTextbaseConfig } from 'src/configuration';
import { Util } from 'src/util';

// Deliberately its own consumer group, not KafkaListenerService's
// KAFKA_GROUP_ID (used for vectorizing) - two consumers sharing one group
// id on a single-partition topic would have Kafka load-balance messages
// between them instead of delivering every message to both, so
// vectorizing and enrichment would silently steal each other's events.
const ENRICHMENT_KAFKA_GROUP_ID = 'biblioteca_nestjs_enrichment';

/**
 * A second, independent consumer of newOpusImportedTopic (the same topic
 * KafkaListenerService vectorizes from): enriches the opus and, if not
 * already enriched, its author - the same work EnrichmentService.
 * dailySweep() does once a day in a bounded batch, but now driven
 * per-opus as imports actually happen, instead of only catching up
 * hours or days later. dailySweep() stays as-is as a backstop for
 * anything this listener misses (a stale/replayed-past-retention event,
 * a transient failure that exhausted its own retries).
 */
@Injectable()
export class EnrichmentKafkaListenerService implements OnApplicationShutdown, OnModuleInit {

  consumer: Consumer;

  private readonly log = new Logger(EnrichmentKafkaListenerService.name);

  constructor(
    protected ks: KafkaService,
    protected tbc: BibliotecaClient,
    protected enrichment: EnrichmentService,
    @Inject(PROVIDER_SHARED_CONFIG) protected sharedConfig: SharedTextbaseConfig,
  ) { }

  async onModuleInit() {
    await this.initKafkaListener();
  }

  async initKafkaListener() {
    this.consumer = this.ks.kafka.consumer({
      groupId: ENRICHMENT_KAFKA_GROUP_ID,
      sessionTimeout: 30 * 60 * 1000,
      heartbeatInterval: 3 * 60 * 1000,
    });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [this.sharedConfig.kafka.newOpusImportedTopic],
      // A brand-new consumer group starts with no committed offset -
      // replaying the whole retained topic history (rather than only
      // events from this point forward) means the exact backlog that
      // motivated adding this listener - opera/authors imported before
      // it existed - gets a chance to be enriched too, not just future
      // imports. Bounded by the topic's own retention, same as any
      // replay; dailySweep() remains the backstop beyond that.
      fromBeginning: true,
    });
    await this.consumer.run({
      eachMessage: (async ({ message, heartbeat }) => {
        for (;;) {
          try {
            await Util.delay(2 * 1000); // same as KafkaListenerService: opus not always readable immediately after import
            await heartbeat();

            const asJson = message.value.toString();
            const obj = JSON.parse(asJson);
            if (!obj.path) throw new Error(`Kafka event on ${this.sharedConfig.kafka.newOpusImportedTopic} has no opus path: ${asJson}`);

            // Re-fetch by path rather than trusting the event's own id,
            // same reasoning as KafkaListenerService - some older events
            // carry an id that's since gone stale. Cast to any: the
            // generated TeiElemDto (biblioteca.api.ts) predates the
            // summary/author fields the server's actual /api/divs
            // response carries, same reasoning as dailySweep()'s own
            // (authors as any[])/(opus: any) casts below.
            const opus = await this.tbc.getElemByPath(obj.path) as any;
            await heartbeat();

            if (opus && !opus.summary) {
              this.log.log(`enrichment candidate work ${opus.id} ${opus.head}`);
              await this.enrichment.enrichWork(opus);
            }

            const authorStrId = opus?.author?.strId;
            if (authorStrId) {
              // No single-author-by-strId lookup exposes bio (the DREST
              // projection omits it) - the flat getAuthors() list is the
              // same source dailySweep() already relies on for this.
              const authors = await this.tbc.getAuthors();
              const author = (authors as any[]).find(a => a.strId === authorStrId);
              if (author && !author.bio) {
                this.log.log(`enrichment candidate author ${author.strId}`);
                await this.enrichment.enrichAuthor(author);
              }
            }
            return;
          } catch (err: any) {
            // Same definitive-vs-retryable split as KafkaListenerService:
            // a 404/400 from the server is a verdict an identical retry
            // can never change (opus gone, or a stale legacy event path).
            if (err && (err.status === 404 || err.status === 400)) {
              this.log.warn(`opus rejected by the server (${err.status}) - skipping enrichment for this event`,
                message.value.toString());
              return;
            }
            this.log.error('failed to process opus event for enrichment; retaining the Kafka offset and retrying in 10 seconds', err);
            await Util.delay(10 * 1000);
            await heartbeat();
          }
        }
      }),
    });
  }

  onApplicationShutdown(_signal?: string) {
    this.consumer?.disconnect();
  }
}
