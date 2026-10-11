import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Consumer } from 'kafkajs';
import { KafkaService } from './kafka.service';
import { BibliotecaClient } from '../biblioteca_client.service';
import { CoverEnrichmentService } from '../cover-enrichment.service';
import { PROVIDER_SHARED_CONFIG, SharedTextbaseConfig } from 'src/configuration';
import { describeKafkaError, isMembershipError } from './error-details';
import { randomAuthorArt } from './author-arts';

// Its own group: the cover requests are a separate stream from the
// import/reimport events the other listeners consume.
const WORK_ENRICHMENT_KAFKA_GROUP_ID = 'biblioteca_nestjs_work_enrichment';

/**
 * Generates a random cover for a work the server served without one: the
 * reader's catalog, author pages, carousels and work cards make
 * biblioteca-server publish {"strId": "author/work"} on enrichWorkTopic
 * (its CoverEnrichmentRequests, throttled per work). Covers are fill-only:
 * a work that has one by the time the request arrives is left alone.
 */
@Injectable()
export class WorkEnrichmentKafkaListenerService implements OnApplicationShutdown, OnModuleInit {

  consumer?: Consumer;

  private readonly log = new Logger(WorkEnrichmentKafkaListenerService.name);

  constructor(
    protected ks: KafkaService,
    protected tbc: BibliotecaClient,
    protected covers: CoverEnrichmentService,
    @Inject(PROVIDER_SHARED_CONFIG) protected sharedConfig: SharedTextbaseConfig,
  ) { }

  async onModuleInit() {
    const topic = this.sharedConfig.kafka.enrichWorkTopic;
    if (!topic) {
      this.log.warn('biblioteca-server announces no enrichWorkTopic (older server) - work cover requests are not consumed');
      return;
    }
    await this.ks.ensureTopics([topic]);
    this.consumer = this.ks.kafka.consumer({
      groupId: WORK_ENRICHMENT_KAFKA_GROUP_ID,
      sessionTimeout: 30 * 1000,
      heartbeatInterval: 10 * 1000,
    });
    await this.consumer.connect();
    // Requests are about what readers look at now: a fresh group skips the
    // retained backlog, and the server re-asks for any work still uncovered.
    await this.consumer.subscribe({ topics: [topic], fromBeginning: false });
    this.log.log(`listening on Kafka topic ${topic}`);
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        let strId = '<unknown>';
        try {
          strId = JSON.parse(message.value?.toString() ?? '{}').strId || strId;
          await this.handleEnrichWork(strId);
        } catch (err: any) {
          if (isMembershipError(err)) throw err; // rejoin; the request is redelivered
          // Best-effort: the server asks again on a later view, so a failed
          // request is logged and dropped rather than blocking the topic.
          this.log.warn(`work enrichment request for ${strId} failed — ${await describeKafkaError(err)}`);
        }
      },
    });
  }

  /** One request: schedule a random cover for the work, unless it has one. Returns whether a cover was enqueued. */
  async handleEnrichWork(strId: string): Promise<boolean> {
    if (!strId || !/^[^/]+\/[^/]+$/.test(strId)) {
      this.log.warn(`ignoring work enrichment request with an invalid strId: ${strId}`);
      return false;
    }
    let opus: any;
    try {
      opus = await this.tbc.getElemByPath(strId);
    } catch (err: any) {
      if (err?.status === 404 || err?.status === 400) {
        this.log.warn(`work ${strId} rejected by the server (${err.status}) - no cover`);
        return false;
      }
      throw err;
    }
    if (!opus?.id || !opus?.path || !opus?.head) return false;
    if (opus.coverUrl) {
      this.log.log(`work ${strId} already has a cover - nothing to do`);
      return false;
    }
    const author = opus.author;
    let artUrl: string | undefined;
    if (author?.strId) {
      try {
        artUrl = await randomAuthorArt(this.tbc, author.strId);
      } catch (error: any) {
        this.log.warn(`author media lookup failed for ${author.strId}; rendering without art: ${error?.message || error}`);
      }
    }
    this.log.log(`cover requested for ${opus.path}${artUrl ? ` (art ${artUrl})` : ''}`);
    // Fire-and-forget like the import listener: a render takes far longer
    // than a consumer session; CoverEnrichmentService queues and dedupes.
    void this.covers.enqueue({
      id: opus.id,
      path: opus.path,
      title: opus.head,
      author: author?.displayName || author?.visualName || author?.strId || 'Anonymous',
      coverUrl: opus.coverUrl,
      artUrl,
    });
    return true;
  }

  onApplicationShutdown(_signal?: string) {
    this.consumer?.disconnect();
  }
}
