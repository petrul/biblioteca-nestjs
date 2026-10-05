import { Inject, Injectable, Logger} from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { PROVIDER_CONF, VectorizerConfiguration } from '../../configuration';

export function parseKafkaBrokers(kafkaServers: string): string[] {
  return kafkaServers
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);
}

@Injectable()
export class KafkaService {

  public readonly kafka: Kafka; 
  private readonly logger = new Logger(KafkaService.name);

  constructor(@Inject(PROVIDER_CONF) private config: VectorizerConfiguration) {
    const kafkaBrokers = parseKafkaBrokers(this.config.kafkaServers);
    this.logger.log(`Kafka brokers: ${kafkaBrokers.join(', ')}`);
    this.kafka = new Kafka({
      clientId: 'biblioteca-nestjs',
      brokers: kafkaBrokers,
    });
  }

  /**
   * Creates the given topics if they don't exist yet - idempotent, safe to
   * call on every boot. Kafka's auto.create.topics.enable only fires on
   * PRODUCE, never on a consumer's metadata request (KIP-487), so a
   * consumer-first service facing a fresh broker otherwise dies with
   * "This server does not host this topic-partition" before it can
   * subscribe. A topic that already exists (created by the server, or
   * concurrently by another worker) is success, not an error.
   */
  async ensureTopics(topics: string[]): Promise<void> {
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      try {
        await admin.createTopics({
          topics: topics.map(topic => ({ topic, numPartitions: 1, replicationFactor: 1 })),
          waitForLeaders: false,
        });
        this.logger.log(`created missing Kafka topics: ${topics.join(', ')}`);
      } catch (error) {
        if (!/already exists/i.test(String(error?.message ?? error))) throw error;
        this.logger.log(`Kafka topics already present: ${topics.join(', ')}`);
      }
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }
}
