import { Injectable, Logger, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka } from 'kafkajs';

@Injectable()
export class KafkaService {

  public readonly kafka: Kafka; 
  private readonly logger = new Logger(KafkaService.name);

  constructor(private config: ConfigService) {
    const kafkaBrokers = this.config.get<string>('kafkaServers');
    console.log('kafkaBrokers', kafkaBrokers);
    this.logger.log(kafkaBrokers)
    this.kafka = new Kafka({      
      brokers: [ kafkaBrokers ],
    });
  }
}
