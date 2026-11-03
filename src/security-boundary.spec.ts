import { requiresInternalApiToken } from './security-boundary';

describe('internal API boundary', () => {
  it('protects every RAG execution route', () => {
    for (const path of ['/api/rag/search', '/api/rag/ask', '/api/rag/ask/stream', '/api/rag/chat']) {
      expect(requiresInternalApiToken('POST', path)).toBe(true);
    }
  });

  it('does not accidentally protect ordinary reads or unrelated methods', () => {
    expect(requiresInternalApiToken('GET', '/api/rag/search')).toBe(false);
    expect(requiresInternalApiToken('POST', '/health')).toBe(false);
  });
});
