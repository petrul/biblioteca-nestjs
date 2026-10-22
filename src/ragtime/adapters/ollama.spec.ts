/// <reference types="jest" />
import { OllamaEmbedder } from './ollama.embedder';
import { GENERATION_OPTIONS, OllamaChatModel } from './ollama.chat-model';

const restores: (() => void)[] = [];
function mockFetch(handler: (url: string, body: any) => { status?: number; body?: any; stream?: string[] }) {
  const calls: { url: string; body: any }[] = [];
  const original = (global as any).fetch;
  (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, body });
    const r = handler(url, body);
    const status = r.status ?? 200;
    const encoder = new TextEncoder();
    return {
      ok: status < 400, status, text: async () => 'details', json: async () => r.body ?? {},
      body: r.stream ? (async function* () { for (const chunk of r.stream!) yield encoder.encode(chunk); })() : undefined,
    } as any;
  });
  restores.push(() => { (global as any).fetch = original; });
  return calls;
}
afterEach(() => { while (restores.length) restores.pop()!(); });

describe('OllamaEmbedder', () => {
  it('posts the model, the inputs with the purpose prefix and keep_alive, and returns the embeddings', async () => {
    const calls = mockFetch((_url, body) => ({ body: { embeddings: body.input.map(() => [0.1, 0.2]) } }));
    const embedder = new OllamaEmbedder({ url: 'http://ollama.test:11434/', model: 'e5', dimension: 2, keepAlive: -1, queryPrefix: 'query: ', passagePrefix: 'passage: ' });
    expect(await embedder.embedBatch(['a', 'b'])).toEqual([[0.1, 0.2], [0.1, 0.2]]);
    expect(await embedder.embed('q', 'query')).toEqual([0.1, 0.2]);
    expect(calls[0]).toEqual({ url: 'http://ollama.test:11434/api/embed', body: { model: 'e5', input: ['passage: a', 'passage: b'], keep_alive: -1 } });
    expect(calls[1].body.input).toEqual(['query: q']);
  });

  it("leaves keep_alive to Ollama when not set, and reports errors with the model and details", async () => {
    const calls = mockFetch(() => ({ status: 500 }));
    const embedder = new OllamaEmbedder({ url: 'http://o', model: 'm', dimension: 2 });
    await expect(embedder.embedBatch(['a'])).rejects.toThrow("Ollama /api/embed failed for model 'm': HTTP 500 details");
    expect(calls[0].body).not.toHaveProperty('keep_alive');
    expect(await embedder.embedBatch([])).toEqual([]);
  });

  it('refuses a response with the wrong number of embeddings', async () => {
    mockFetch(() => ({ body: { embeddings: [[1]] } }));
    await expect(new OllamaEmbedder({ url: 'http://o', model: 'm', dimension: 1 }).embedBatch(['a', 'b'])).rejects.toThrow('1 embeddings for 2 texts');
  });
});

describe('OllamaChatModel', () => {
  const ollama = (loaded: { name: string; caps: string[] }[]) => mockFetch((url, body) => {
    if (url.endsWith('/api/ps')) return { body: { models: loaded.map((m) => ({ name: m.name })) } };
    if (url.endsWith('/api/show')) return { body: { capabilities: loaded.find((m) => m.name === body.model)!.caps } };
    if (body.stream) return { stream: ['{"message":{"content":"Hel"}}\n{"message":{"con', 'tent":"lo"}}\n', '{"done":true}'] };
    return { body: { message: { content: 'Hello' } } };
  });

  it('reuses the loaded generating model - never the pinned embedding one - with the shared generation options', async () => {
    const calls = ollama([{ name: 'bge-m3:latest', caps: ['embedding'] }, { name: 'gemma3:12b', caps: ['completion'] }]);
    const model = new OllamaChatModel({ url: 'http://ollama.test:11434' });
    expect(await model.complete([{ role: 'user', content: 'hi' }], { json: true })).toBe('Hello');
    const chat = calls.find((c) => c.url.endsWith('/api/chat'))!;
    expect(chat.body).toMatchObject({ model: 'gemma3:12b', stream: false, think: false, options: GENERATION_OPTIONS, format: 'json', messages: [{ role: 'user', content: 'hi' }] });
    expect(model.modelName).toBe('gemma3:12b');
  });

  it('falls back to the default model when nothing generating is loaded, or always uses it when fixed', async () => {
    let calls = ollama([{ name: 'bge-m3:latest', caps: ['embedding'] }]);
    await new OllamaChatModel({ url: 'http://o' }).complete([{ role: 'user', content: 'hi' }]);
    expect(calls.find((c) => c.url.endsWith('/api/chat'))!.body.model).toBe('qwen3.5:9b');

    calls = ollama([{ name: 'gemma3:12b', caps: ['completion'] }]);
    await new OllamaChatModel({ url: 'http://o', modelChoice: 'fixed', defaultModel: 'llama3.1:8b' }).complete([{ role: 'user', content: 'hi' }]);
    expect(calls.map((c) => c.url)).toEqual(['http://o/api/chat']);
    expect(calls[0].body.model).toBe('llama3.1:8b');
  });

  it('streams the answer from newline-delimited JSON split anywhere', async () => {
    ollama([]);
    const chunks: string[] = [];
    for await (const chunk of new OllamaChatModel({ url: 'http://o' }).stream([{ role: 'user', content: 'hi' }])) chunks.push(chunk);
    expect(chunks.join('')).toBe('Hello');
  });
});
