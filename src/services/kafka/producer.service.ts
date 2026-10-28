import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { KafkaService } from './kafka.service';
import { Producer } from 'kafkajs';

@Injectable()
export class ProducerService implements OnModuleInit, OnApplicationShutdown {

    producer: Producer;
    private connected: Promise<void> = Promise.resolve();

    constructor(kserv: KafkaService) {
        this.producer = kserv.kafka.producer();
    }

    onApplicationShutdown(_signal?: string) {
        this.producer.disconnect();
    }

    onModuleInit() {
        this.connected = this.producer.connect();
    }

    async sendJson(topic: string, value: unknown): Promise<void> {
        await this.connected;
        await this.producer.send({ topic, messages: [{ value: JSON.stringify(value) }] });
    }

}
