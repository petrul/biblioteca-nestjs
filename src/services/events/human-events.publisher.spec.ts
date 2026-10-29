import { HumanEventPublisher } from './human-events.publisher';

// biblioteca-nestjs's human events - a chat message, a RAG search, a question -
// go to the one topic biblioteca-server names (biblioteca_events), as flat JSON;
// nothing comes from the environment. The server's HumanEventsTest covers login
// and search; rag.service.spec covers when each of these is published.
describe('HumanEventPublisher', () => {
  const shared = (humanEventsTopic?: string) => ({ kafka: { humanEventsTopic } }) as any;

  it('publishes a flat event, with its details, on the topic the server names', async () => {
    const sendJson = jest.fn().mockResolvedValue(undefined);
    await new HumanEventPublisher({ sendJson } as any, shared('biblioteca_events'))
      .publish('chat', { message: 'Cine este Angelica?', conversationId: 'c-1', scope: { opusPaths: ['ariosto_ludovico/orlando_furioso'] }, user: undefined });

    expect(sendJson).toHaveBeenCalledTimes(1);
    const [topic, event] = sendJson.mock.calls[0];
    expect(topic).toBe('biblioteca_events');
    expect(Object.keys(event)).toEqual(['type', 'at', 'service', 'message', 'conversationId', 'scope']);
    expect(event).toMatchObject({ type: 'chat', service: 'biblioteca-nestjs', message: 'Cine este Angelica?' });
    expect(Number.isNaN(Date.parse(event.at))).toBe(false);
  });

  it('needs no environment: mail, ntfy or token settings play no part', async () => {
    const sendJson = jest.fn().mockResolvedValue(undefined);
    const saved = { ...process.env };
    for (const key of ['CONTACT_MAIL_TO', 'SMTP_FROM', 'NTFY_URL', 'NTFY_TOKEN']) delete process.env[key];
    try {
      await new HumanEventPublisher({ sendJson } as any, shared('biblioteca_events')).publish('ask', { message: 'q' });
    } finally {
      process.env = saved;
    }
    expect(sendJson).toHaveBeenCalledWith('biblioteca_events', expect.objectContaining({ type: 'ask' }));
  });

  it('skips quietly on a server that names no topic, and never fails the chat when Kafka does', async () => {
    const sendJson = jest.fn().mockRejectedValue(new Error('Kafka is down'));
    await new HumanEventPublisher({ sendJson } as any, shared(undefined)).publish('chat', {});
    expect(sendJson).not.toHaveBeenCalled();
    await expect(new HumanEventPublisher({ sendJson } as any, shared('biblioteca_events')).publish('chat', {})).resolves.toBeUndefined();
  });
});
