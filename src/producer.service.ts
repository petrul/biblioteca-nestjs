import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { KafkaService } from './services/kafka/kafka.service';
import { Producer } from 'kafkajs';

@Injectable()
export class ProducerService implements OnModuleInit, OnApplicationShutdown {

    producer: Producer;

    constructor(kserv: KafkaService) {
        this.producer = kserv.kafka.producer();
    }

    onApplicationShutdown(_signal?: string) {
        this.producer.disconnect();
    }

    onModuleInit() {
        this.producer.connect();
    }

}
