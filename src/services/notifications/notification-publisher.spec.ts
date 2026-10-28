import { NotificationPublisher } from './notification-publisher.service';

describe('NotificationPublisher', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('fans chat usage out to Greg mail and ntfy topics', async () => {
    process.env.CONTACT_MAIL_TO = 'reader@example.test';
    process.env.SMTP_FROM = 'biblioteca@example.test';
    process.env.NTFY_URL = 'https://ntfy.sh/example';
    const sendJson = jest.fn().mockResolvedValue(undefined);
    await new NotificationPublisher({ sendJson } as any).chatUsed('despre ce e vorba?', { opusPaths: ['a/b'] }, 'conversation-1');
    expect(sendJson).toHaveBeenCalledTimes(2);
    expect(sendJson).toHaveBeenCalledWith('greg-send-mail', expect.objectContaining({ to: 'reader@example.test', subject: 'Biblioteca chat' }));
    expect(sendJson).toHaveBeenCalledWith('greg-send-notification', expect.objectContaining({ to: 'https://ntfy.sh/example', tags: ['biblioteca', 'chat'] }));
  });

  it('does not publish when the Greg destinations are not configured', async () => {
    delete process.env.CONTACT_MAIL_TO;
    delete process.env.SMTP_FROM;
    delete process.env.NTFY_URL;
    const sendJson = jest.fn();
    await new NotificationPublisher({ sendJson } as any).chatUsed('hello', {}, 'conversation-1');
    expect(sendJson).not.toHaveBeenCalled();
  });
});
