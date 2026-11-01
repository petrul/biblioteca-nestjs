import { Writable } from 'node:stream';
import { currentInitiator, guestLabel, INITIATOR_HEADER, prefixLines, propagateInitiator, receivedLabel, runAs } from './initiator';

// The same module as biblioteca-reader's src/services/initiator.ts - its
// initiator.test.ts covers it fully; these pin what this service relies on.
describe('initiator', () => {
  it('derives the same guest label as the reader and biblioteca-server', () => {
    expect(guestLabel('visitor-1')).toBe('guest-witty-owl-38c6');
  });

  it('accepts only label-shaped headers', () => {
    expect(receivedLabel('petru@scriptorium.ro')).toBe('petru@scriptorium.ro');
    expect(receivedLabel('a\nFAKE LINE')).toBeUndefined();
    expect(receivedLabel('system')).toBeUndefined();
  });

  it('prefixes every line with the initiator of the work writing it', () => {
    const chunks: string[] = [];
    const stream = new Writable({ write(chunk, _encoding, done) { chunks.push(chunk.toString()); done(); } });
    prefixLines(stream);
    stream.write('[Nest] started\n');
    runAs('petru@scriptorium.ro', () => stream.write('cover queued\nsecond line\n'));
    expect(chunks.join('')).toBe('(system) [Nest] started\n(petru@scriptorium.ro) cover queued\n(petru@scriptorium.ro) second line\n');
    expect(currentInitiator()).toBe('system');
  });

  it('passes the initiator on to the Biblioteca services only', async () => {
    const original = globalThis.fetch;
    const seen: Array<string | null> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Request(input, init).headers.get(INITIATOR_HEADER));
      return new Response('{}');
    }) as typeof fetch;
    try {
      propagateInitiator(['http://server.test:8080']);
      await runAs('guest-amber-otter-3f2a', async () => {
        await fetch('http://server.test:8080/api/internal/enrichment');
        await fetch('https://en.wikipedia.org/w/api.php');
      });
    } finally {
      globalThis.fetch = original;
    }
    expect(seen).toEqual(['guest-amber-otter-3f2a', null]);
  });
});
