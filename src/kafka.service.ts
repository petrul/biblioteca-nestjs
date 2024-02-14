import { Injectable } from '@nestjs/common';
import { Kafka } from 'kafkajs';

@Injectable()
export class KafkaService {
  public readonly kafka = new Kafka({
    brokers: ['localhost:30115'],
  });
}
