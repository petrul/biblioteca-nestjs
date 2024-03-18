import { Injectable, Logger} from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { AppConfService } from 'src/configuration';

@Injectable()
export class KafkaService {

  public readonly kafka: Kafka; 
  private readonly logger = new Logger(KafkaService.name);

  constructor(private config: AppConfService) {
    const kafkaBrokers = this.config.kafkaServers;
    console.log('kafkaBrokers', kafkaBrokers);
    this.logger.log(kafkaBrokers)
    this.kafka = new Kafka({      
      brokers: [ kafkaBrokers ],
    });
  }
}
