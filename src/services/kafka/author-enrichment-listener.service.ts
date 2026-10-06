import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { KafkaService } from './kafka.service';
import { Consumer } from 'kafkajs';
import { BibliotecaClient } from '../biblioteca_client.service';
import { EnrichmentService } from '../enrichment.service';
import { PROVIDER_SHARED_CONFIG, SharedTextbaseConfig } from 'src/configuration';
import { Util } from 'src/util';
import { CoverEnrichmentService } from '../cover-enrichment.service';
import { describeKafkaError, isMembershipError } from './error-details';

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
    // The topics must exist before the consumer's first metadata request:
    // a fresh broker has none of them, and a consumer never triggers
    // Kafka's own auto-create (that fires on produce only) - see
    // KafkaService.ensureTopics.
    await this.ks.ensureTopics([
      this.sharedConfig.kafka.newOpusImportedTopic,
      this.sharedConfig.kafka.opusReimportedTopic,
    ]);
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
            this.log.log(`received opus event for enrichment and cover generation: ${obj.path}`);

            // The div response embeds its author as an AuthorDto, which
            // carries bio (present-or-null) precisely so this check needs
            // no second query - bio present means already enriched, skip.
            const author = opus?.author;
            let artUrl: string | undefined;
            if (author && !author.bio) {
              this.log.log(`enrichment candidate author ${author.strId}`);
              // The author's art is returned by the enrichment itself,
              // retrieved BEFORE the cover order below so the portrait
              // makes it into the render - covers are fill-only, an
              // ordered cover is never re-rendered with art later.
              // Author enrichment is optional decoration.  It must never
              // prevent the opus cover from being scheduled: Wikimedia can
              // be unavailable while the renderer and MinIO are healthy.
              try {
                artUrl = (await this.enrichment.enrichAuthor(author))?.[0];
              } catch (error: any) {
                this.log.warn(`author enrichment failed for ${author.strId}; continuing with cover generation: ${error?.message || error}`);
              }
            }
            // Re-ask the server for the author with all its media - the
            // images enrichment persisted (just now or on earlier runs) plus
            // the bundled portrait - and pick one at random, so a corpus
            // does not get one repeated portrait. The freshly retrieved art
            // only stands in when the server has nothing associated yet.
            if (author?.strId) {
              try {
                const arts = await this.authorArts(author.strId);
                if (arts.length) artUrl = arts[Math.floor(Math.random() * arts.length)];
              } catch (error: any) {
                this.log.warn(`author media lookup failed for ${author.strId}; continuing with ${artUrl ? 'the enrichment art' : 'no artwork'}: ${error?.message || error}`);
              }
            }
            // Cover generation is a separate slow job. It is triggered by the
            // same successful import notification but has its own dedupe set,
            // so it never blocks vectorization or Wikipedia enrichment.
            if (opus?.id && opus?.path && opus?.head) {
              if (!opus.coverUrl && !this.covers.accepting) {
                // Do not acknowledge an event the cover pipeline cannot take
                // (MinIO not configured) - the outer loop retains the offset
                // and retries.
                throw new Error(`cover pipeline unavailable; cover not scheduled for ${opus.path}`);
              }
              this.log.log(`cover candidate from opus event: ${opus.path}${artUrl ? ` (art ${artUrl})` : ''}`);
              // Fire-and-forget: the render takes up to minutes, far beyond
              // the consumer session timeout - awaiting it here would get
              // the consumer evicted and the event redelivered.
              void this.covers.enqueue({
                id: opus.id,
                path: opus.path,
                title: opus.head,
                author: author?.displayName || author?.visualName || author?.strId || 'Anonymous',
                coverUrl: opus.coverUrl,
                artUrl,
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
            // Same membership-error reasoning as
            // VectorizerKafkaListenerService: an evicted consumer cannot
            // retry its way back into the group - rethrow so KafkaJS
            // rejoins, and the uncommitted offset redelivers this event.
            if (isMembershipError(err)) {
              let evictedPath = '<unknown>';
              try { evictedPath = JSON.parse(message.value.toString()).path || evictedPath; } catch { /* described below */ }
              this.log.error(`consumer evicted from the Kafka group while processing opus ${evictedPath} for author enrichment - rejoining; the opus will be redelivered — ${await describeKafkaError(err)}`);
              throw err;
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

  /** The author's image URLs as the server associates them, deduplicated. */
  private async authorArts(strId: string): Promise<string[]> {
    const author = await this.tbc.getAuthor(strId);
    return [
      ...(Array.isArray(author?.imageUrls) ? author.imageUrls : []),
      ...(author?.image_href ? [author.image_href] : []),
    ].filter((url, i, all) => typeof url === 'string' && url.length > 0 && all.indexOf(url) === i);
  }

  onApplicationShutdown(_signal?: string) {
    this.consumer?.disconnect();
  }
}
