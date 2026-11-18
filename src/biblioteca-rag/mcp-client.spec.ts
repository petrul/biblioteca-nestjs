/// <reference types="jest" />
import { McpClient } from './mcp-client';

function json(body: unknown, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function sse(events: unknown[], headers: Record<string, string> = {}): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
}

describe('McpClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('performs the streamable HTTP handshake, carries the session, and calls tools', async () => {
    const calls: Array<{ url: string; body: any; headers: Headers }> = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ url: String(input), body, headers: new Headers(init?.headers) });
      switch (calls.length) {
        case 1:
          return json({ result: { protocolVersion: '2025-06-18' } }, { 'mcp-session-id': 'session-42' });
        case 2:
          return new Response(null, { status: 202, headers: { 'mcp-session-id': 'session-42' } });
        case 3:
          return sse([{ result: { tools: [{ name: 'search_lucene', description: 'full text', inputSchema: { type: 'object' } }] } }]);
        default:
          return json({ result: { structuredContent: { hits: [{ url: '/shakespeare/hamlet/p1' }] } } });
      }
    }) as typeof fetch;

    const client = new McpClient('http://biblioteca.test/', 'secret-token');
    await client.initialize();
    await expect(client.tools()).resolves.toEqual([
      { name: 'search_lucene', description: 'full text', inputSchema: { type: 'object' } },
    ]);
    await expect(client.call('search_lucene', { q: 'ghosts' })).resolves.toEqual({
      hits: [{ url: '/shakespeare/hamlet/p1' }],
    });

    expect(calls.map(call => call.url)).toEqual([
      'http://biblioteca.test/mcp',
      'http://biblioteca.test/mcp',
      'http://biblioteca.test/mcp',
      'http://biblioteca.test/mcp',
    ]);
    expect(calls[0].body).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(calls[1].body).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    expect(calls[2].body).toMatchObject({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(calls[3].body).toMatchObject({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
      name: 'search_lucene', arguments: { q: 'ghosts' },
    } });
    for (const call of calls) {
      expect(call.headers.get('authorization')).toBe('Bearer secret-token');
      expect(call.headers.get('content-type')).toBe('application/json');
    }
    expect(calls[0].headers.get('mcp-session-id')).toBeNull();
    expect(calls[1].headers.get('mcp-session-id')).toBe('session-42');
    expect(calls[3].headers.get('mcp-session-id')).toBe('session-42');
  });

  it('decodes text tool results and surfaces MCP errors', async () => {
    let call = 0;
    global.fetch = jest.fn(async () => {
      call += 1;
      if (call === 1) return json({ result: {} }, { 'mcp-session-id': 's' });
      if (call === 2) return new Response(null, { status: 202 });
      if (call === 3) return json({ result: { content: [{ type: 'text', text: '{"answer":"ok"}' }] } });
      return json({ error: { message: 'tool failed' } });
    }) as typeof fetch;

    const client = new McpClient('http://biblioteca.test/mcp', 'secret-token');
    await client.initialize();
    await expect(client.call('read_text', { path: 'hamlet/act1' })).resolves.toEqual({ answer: 'ok' });
    await expect(client.call('read_text', { path: 'hamlet/act1' })).rejects.toThrow('tool failed');
  });

  it('rejects missing credentials before making a request', () => {
    expect(() => new McpClient('http://biblioteca.test', '')).toThrow('BIBLIOTECA_INTERNAL_API_TOKEN');
    expect(() => new McpClient('', 'secret-token')).toThrow('BIBLIOTECA_EXTERNAL_URL');
  });
});
