/// <reference types="jest" />
import { bibliotecaChatModel, CHAT_MODEL_KEEP_ALIVE } from './ragtime.providers';

// Biblioteca keeps its chat model loaded on the shared Ollama for 6 hours
// after each use. With Ollama's 5-minute default it unloaded between chats and
// the next one waited ~50 s for the 9B model to load again.
describe('Biblioteca chat model', () => {
  const original = (global as any).fetch;
  afterEach(() => { (global as any).fetch = original; });

  it('asks Ollama to keep it loaded for 6 hours, on every request', async () => {
    const bodies: any[] = [];
    (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/ps')) return { ok: true, json: async () => ({ models: [] }) } as any;
      bodies.push(JSON.parse(init!.body as string));
      return { ok: true, json: async () => ({ message: { content: 'answer' } }) } as any;
    });
    const model = bibliotecaChatModel('http://ollama.test:11434');
    await model.complete([{ role: 'user', content: 'Ce face Astolfo pe Lună?' }]);
    await model.complete([{ role: 'user', content: 'Și apoi?' }]);

    expect(CHAT_MODEL_KEEP_ALIVE).toBe('6h');
    expect(bodies.map(body => body.keep_alive)).toEqual(['6h', '6h']);
    expect(bodies[0].model).toBe('qwen3.5:9b');
  });
});
