/// <reference types="jest" />
import { OllamaEmbedder } from './ollama.embedder';
import { TestUtils } from '../../../test/testutils';

/**
 * Live: the shared zmeu Ollama serves bge-m3, the active embedder - pinned
 * there (keep_alive -1) next to one generating model, as every client does.
 * Only bge-m3: other embedding models would evict the generating model from
 * the shared GPU.
 */
describe('OllamaEmbedder with bge-m3 (live)', () => {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://zmeu.local:11434';
  const bgeM3 = new OllamaEmbedder({ url: ollamaUrl, model: 'bge-m3', dimension: 1024, keepAlive: -1 });

  it('is served, and encodes multilingual text into distinct 1024-dim vectors, deterministically', async () => {
    const tags = await (await fetch(`${ollamaUrl}/api/tags`)).json();
    expect((tags?.models ?? []).map((it: any) => it.name)).toContain('bge-m3:latest');

    const sentences = ['scrieți', 'foaie verde', '自由与责任'];
    const vectors = await bgeM3.embedBatch(sentences);
    expect(vectors).toHaveLength(3);
    vectors.forEach((it) => expect(it).toHaveLength(1024));
    expect(vectors[0]).not.toEqual(vectors[1]);
    expect(await bgeM3.embedBatch(sentences)).toEqual(vectors);
  }, TestUtils.TIMEOUT_TWO_MINUTES);
});
