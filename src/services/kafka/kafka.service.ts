import { Inject, Injectable, Logger} from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { PROVIDER_CONF, VectorizerConfiguration } from '../../configuration';

@Injectable()
export class KafkaService {

  public readonly kafka: Kafka; 
  private readonly logger = new Logger(KafkaService.name);

  constructor(@Inject(PROVIDER_CONF) private config: VectorizerConfiguration) {
    const kafkaBrokers = this.config.kafkaServers;
    console.log('kafkaBrokers', kafkaBrokers);
    this.logger.log(kafkaBrokers)
    this.kafka = new Kafka({      
      brokers: [ kafkaBrokers ],
    });
  }
}
