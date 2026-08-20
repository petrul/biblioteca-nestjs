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
      brokers: kafkaBrokers,
    });
  }
}
