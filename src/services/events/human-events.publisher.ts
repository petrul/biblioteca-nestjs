import { Inject, Injectable, Logger } from '@nestjs/common';
import { PROVIDER_SHARED_CONFIG, SharedTextbaseConfig } from '../../configuration';
import { currentInitiator, isUserLabel } from '../../initiator';
import { ProducerService } from '../kafka/producer.service';

export const SERVICE = 'biblioteca-nestjs';

export type HumanEventType = 'chat' | 'rag-search' | 'ask';

/**
 * Interesting human events - here a chat message, a RAG search or a question -
 * published as flat JSON on biblioteca_events, the topic biblioteca-server owns
 * (KafkaProps.humanEventsTopicName) and serves in /api/admin/config. Like every
 * shared topic this service keeps no copy of the name and no setting of its
 * own: on a server too old to name the topic, events are skipped (logged once).
 * Publishing never fails the chat or search it records.
 *
 * Shape (asyncapi.yml's HumanEvent): {type, at, service, user, ...details},
 * where user is who asked - the signed-in user the reader's chat gate let
 * through, which the request runs as (see src/initiator.ts); absent when the
 * request was not a signed-in user's.
 */
@Injectable()
export class HumanEventPublisher {
  private readonly log = new Logger(HumanEventPublisher.name);
  private warnedMissingTopic = false;

  constructor(
    private readonly producer: ProducerService,
    @Inject(PROVIDER_SHARED_CONFIG) private readonly shared: SharedTextbaseConfig,
  ) {}

  async publish(type: HumanEventType, details: Record<string, unknown>): Promise<void> {
    const topic = this.shared.kafka.humanEventsTopic;
    if (!topic) {
      if (!this.warnedMissingTopic) this.log.warn('biblioteca-server names no humanEventsTopic; human events are not published');
      this.warnedMissingTopic = true;
      return;
    }
    const initiator = currentInitiator();
    const event: Record<string, unknown> = { type, at: new Date().toISOString(), service: SERVICE };
    if (isUserLabel(initiator)) event.user = initiator;
    for (const [key, value] of Object.entries(details)) if (value !== undefined && value !== null) event[key] = value;
    try {
      await this.producer.sendJson(topic, event);
    } catch (error) {
      this.log.error(`Could not publish human event ${type}: ${error instanceof Error ? error.message : error}`);
    }
  }
}
