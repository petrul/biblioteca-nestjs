import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { KafkaService } from './kafka.service';
import { Consumer } from 'kafkajs';
import { BibliotecaClient } from '../biblioteca_client.service';
import { EnrichmentService } from '../enrichment.service';
import { PROVIDER_SHARED_CONFIG, SharedTextbaseConfig } from 'src/configuration';
import { Util } from 'src/util';
import { CoverEnrichmentService } from '../cover-enrichment.service';
import { describeKafkaError } from './error-details';

// Deliberately its own consumer group, not VectorizerKafkaListenerService's
// KAFKA_GROUP_ID (used for vectorizing) - two consumers sharing one group
// id on a single-partition topic would have Kafka load-balance messages
// between them instead of delivering every message to both, so
// vectorizing and author enrichment would silently steal each other's
// events.
const AUTHOR_ENRICHMENT_KAFKA_GROUP_ID = 'biblioteca_nestjs_author_enrichment';

/**
 * A second, independent consumer of the import/reimport topics (the same
 * topics VectorizerKafkaListenerService vectorizes from): enriches the author
 * and schedules a work cover after the opus is readable. Its own consumer
 * group ensures slow cover rendering never steals vector events.
 */
@Injectable()
export class AuthorEnrichmentKafkaListenerService implements OnApplicationShutdown, OnModuleInit {

  consumer: Consumer;

  private readonly log = new Logger(AuthorEnrichmentKafkaListenerService.name);

  constructor(
    protected ks: KafkaService,
    protected tbc: BibliotecaClient,
    protected enrichment: EnrichmentService,
    protected covers: CoverEnrichmentService,
    @Inject(PROVIDER_SHARED_CONFIG) protected sharedConfig: SharedTextbaseConfig,
  ) { }

  async onModuleInit() {
    await this.initKafkaListener();
  }

  async initKafkaListener() {
    this.consumer = this.ks.kafka.consumer({
      groupId: AUTHOR_ENRICHMENT_KAFKA_GROUP_ID,
      sessionTimeout: 30 * 1000,
      heartbeatInterval: 10 * 1000,
    });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [
        this.sharedConfig.kafka.newOpusImportedTopic,
        this.sharedConfig.kafka.opusReimportedTopic,
      ],
      // A brand-new consumer group starts with no committed offset -
      // replaying the whole retained topic history (rather than only
      // events from this point forward) means the exact backlog that
      // motivated adding this listener - authors whose opera were
      // imported before it existed - gets a chance to be enriched too,
      // not just future imports. Bounded by the topic's own retention,
      // same as any replay; dailySweep() remains the backstop beyond
      // that.
      fromBeginning: true,
    });
    this.log.log(`listening on Kafka topics ${this.sharedConfig.kafka.newOpusImportedTopic} and ${this.sharedConfig.kafka.opusReimportedTopic}`);
    await this.consumer.run({
      eachMessage: (async ({ message, heartbeat }) => {
        for (;;) {
          try {
            await Util.delay(2 * 1000); // same as VectorizerKafkaListenerService: opus not always readable immediately after import
            await heartbeat();

            const asJson = message.value.toString();
            const obj = JSON.parse(asJson);
            if (!obj.path) throw new Error(`Kafka event on ${this.sharedConfig.kafka.newOpusImportedTopic} has no opus path: ${asJson}`);

            // Re-fetch by path rather than trusting the event's own id,
            // same reasoning as VectorizerKafkaListenerService - some older events
            // carry an id that's since gone stale. Cast to any: the
            // generated TeiElemDto (biblioteca.api.ts) predates the
            // author field the server's actual /api/divs response
            // carries, same reasoning as dailySweep()'s own
            // (authors as any[])/(opus: any) casts below.
            const opus = await this.tbc.getElemByPath(obj.path) as any;
            await heartbeat();

            // The div response embeds its author as an AuthorDto, which
            // carries bio (present-or-null) precisely so this check needs
            // no second query - bio present means already enriched, skip.
            const author = opus?.author;
            if (author && !author.bio) {
              this.log.log(`enrichment candidate author ${author.strId}`);
              await this.enrichment.enrichAuthor(author);
            }
            // Cover generation is a separate slow job. It is triggered by the
            // same successful import notification but has its own dedupe set,
            // so it never blocks vectorization or Wikipedia enrichment.
            if (opus?.id && opus?.path && opus?.head) {
              this.covers.enqueue({
                id: opus.id,
                path: opus.path,
                title: opus.head,
                author: author?.displayName || author?.visualName || author?.strId || 'Anonymous',
                coverUrl: opus.coverUrl,
              });
            }
            return;
          } catch (err: any) {
            // Same definitive-vs-retryable split as VectorizerKafkaListenerService:
            // a 404/400 from the server is a verdict an identical retry
            // can never change (opus gone, or a stale legacy event path).
            if (err && (err.status === 404 || err.status === 400)) {
              this.log.warn(`opus rejected by the server (${err.status}) - skipping author enrichment for this event`,
                message.value.toString());
              return;
            }
            let eventPath = '<unknown>';
            try { eventPath = JSON.parse(message.value.toString()).path || eventPath; } catch { /* malformed event is described below */ }
            this.log.error(`failed to process opus ${eventPath} for author enrichment; retaining the Kafka offset and retrying in 10 seconds — ${await describeKafkaError(err)}`);
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
