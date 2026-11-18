import { requiresInternalApiToken } from './security-boundary';

describe('internal API boundary', () => {
  it('protects every retrieval and chat execution route', () => {
    for (const path of ['/api/rag/search', '/api/rag/ask', '/api/rag/ask/stream', '/api/rag/chat', '/api/mcp/chat']) {
      expect(requiresInternalApiToken('POST', path)).toBe(true);
    }
  });

  it('does not accidentally protect ordinary reads or unrelated methods', () => {
    expect(requiresInternalApiToken('GET', '/api/rag/search')).toBe(false);
    expect(requiresInternalApiToken('POST', '/api/chat')).toBe(false);
    expect(requiresInternalApiToken('POST', '/health')).toBe(false);
  });
});
