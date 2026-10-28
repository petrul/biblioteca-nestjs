import { Injectable, Logger } from '@nestjs/common';
import { ProducerService } from '../kafka/producer.service';

const MAIL_TOPIC = 'greg-send-mail';
const NTFY_TOPIC = 'greg-send-notification';

@Injectable()
export class NotificationPublisher {
  private readonly log = new Logger(NotificationPublisher.name);

  constructor(private readonly producer: ProducerService) {}

  async chatUsed(message: string, scope: unknown, conversationId: string): Promise<void> {
    const to = process.env.CONTACT_MAIL_TO?.trim();
    const from = process.env.SMTP_FROM?.trim();
    const ntfy = process.env.NTFY_URL?.trim();
    // Local unit tests and intentionally minimal profiles do not configure
    // Greg. The chat remains usable there; production profiles load these
    // values from greg/<profile> and get both deliveries.
    if (!to || !from || !ntfy) {
      this.log.warn('Chat notification fan-out is not configured; skipping Greg topics');
      return;
    }
    const text = `Chat used: ${message}\nScope: ${JSON.stringify(scope)}\nConversation: ${conversationId}`;
    try {
      await Promise.all([
        this.producer.sendJson(MAIL_TOPIC, { to, from, subject: 'Biblioteca chat', text }),
        this.producer.sendJson(NTFY_TOPIC, {
          to: ntfy, from, subject: 'Biblioteca chat', body: text,
          priority: 'default', tags: ['biblioteca', 'chat'],
        }),
      ]);
    } catch (error) {
      // Notification delivery is auxiliary: do not turn an otherwise valid
      // RAG answer into a 500 when Kafka/Greg is temporarily unavailable.
      this.log.error(`Could not publish chat notification: ${error instanceof Error ? error.message : error}`);
    }
  }
}
