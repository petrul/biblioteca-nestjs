import {
  NomicEmbedOllamaService,
  OllamaService,
  Qwen3EmbeddingOllamaService,
} from './ollama.service';
import { Content } from '../../model/model';

describe('OllamaService unit behavior', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('posts the model and batch input and returns embeddings', async () => {
    const embeddings = [[1, 2], [3, 4]];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: 'test-model', embeddings }),
    } as Response);
    const service = new OllamaService({ ollamaServer: 'http://ollama.test' } as any);

    await expect(service.encode('test-model', ['one', 'two'])).resolves.toEqual(embeddings);
    expect(global.fetch).toHaveBeenCalledWith('http://ollama.test/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test-model', input: ['one', 'two'] }),
    });
  });

  it('reports an Ollama HTTP error with model and response details', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'busy',
    } as Response);
    const service = new OllamaService({ ollamaServer: 'http://ollama.test' } as any);

    await expect(service.encode('test-model', ['one'])).rejects.toThrow(
      "Ollama /api/embed failed for model 'test-model': HTTP 503 busy",
    );
  });

  it('wrapper services select their configured model names', async () => {
    const ollama = { encode: jest.fn().mockResolvedValue([[1]]) } as unknown as OllamaService;
    const qwen = new Qwen3EmbeddingOllamaService(ollama);
    const nomic = new NomicEmbedOllamaService(ollama);

    await qwen.encode(['qwen input']);
    await nomic.encode(['nomic input']);

    expect(ollama.encode).toHaveBeenNthCalledWith(1, 'qwen3-embedding:4b', ['qwen input']);
    expect(ollama.encode).toHaveBeenNthCalledWith(2, 'nomic-embed-text:v1.5', ['nomic input']);
  });

  it('adds returned embeddings to content in place', async () => {
    const vectors = [[1, 2], [3, 4]];
    const ollama = { encode: jest.fn().mockResolvedValue(vectors) } as unknown as OllamaService;
    const service = new Qwen3EmbeddingOllamaService(ollama);
    const content: Content[] = [
      { text: 'one', url: '/one', sha256: 'one' },
      { text: 'two', url: '/two', sha256: 'two' },
    ];

    await expect(service.embeddings(content)).resolves.toBe(content);
    expect(content.map(item => item.embedding)).toEqual(vectors);
  });
});
