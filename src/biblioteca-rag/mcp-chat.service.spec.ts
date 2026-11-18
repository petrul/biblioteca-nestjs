/// <reference types="jest" />
import { McpChatService } from './mcp-chat.service';

function response(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
}

describe('McpChatService', () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.BIBLIOTECA_INTERNAL_API_TOKEN;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.BIBLIOTECA_INTERNAL_API_TOKEN;
    else process.env.BIBLIOTECA_INTERNAL_API_TOKEN = originalToken;
  });

  it('discovers Biblioteca tools, executes Qwen tool calls, and keeps a work scope', async () => {
    process.env.BIBLIOTECA_INTERNAL_API_TOKEN = 'test-token';
    const calls: Array<{ url: string; body: any; headers: Headers }> = [];
    let ollamaRound = 0;
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body, headers });
      if (url.endsWith('/mcp')) {
        if (body.method === 'initialize') return response({ result: { protocolVersion: '2025-06-18' } }, { 'mcp-session-id': 'session-1' });
        if (body.method === 'notifications/initialized') return response({}, { 'mcp-session-id': 'session-1' });
        if (body.method === 'tools/list') return response({ result: { tools: [
          { name: 'search_vector', description: 'semantic search', inputSchema: { type: 'object' } },
          { name: 'read_text', description: 'read text', inputSchema: { type: 'object' } },
          { name: 'graphql_query', description: 'not selected', inputSchema: { type: 'object' } },
        ] } });
        if (body.method === 'tools/call') return response({ result: { structuredContent: [
          { type: 'milvus', url: 'https://biblioteca.test/creanga/amintiri/p1', score: 0.2, content: 'Nică merge la școală.' },
        ] } });
      }
      if (url.endsWith('/api/chat')) {
        ollamaRound += 1;
        if (ollamaRound === 1) return response({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_vector', arguments: { q: 'școala lui Nică' } } }] } });
        return response({ message: { role: 'assistant', content: 'Nică merge la școală la Humulești. [creanga/amintiri]' } });
      }
      throw new Error(`unexpected URL ${url}`);
    }) as typeof fetch;

    const service = new McpChatService({ bibliotecaUrl: 'http://server:8080', ollamaUrl: 'http://ollama' } as any);
    const result = await service.chat('Unde merge Nică?', { scope: { opusPaths: ['creanga/amintiri'] } });

    expect(result.answer).toContain('Humulești');
    expect(result.model).toBe('qwen3.5:9b');
    expect(result.passages[0]).toMatchObject({ opusPath: 'creanga/amintiri', text: 'Nică merge la școală.' });
    const toolCall = calls.find(call => call.body?.method === 'tools/call');
    expect(toolCall?.body.params.arguments).toEqual({ q: 'școala lui Nică', scope: ['creanga/amintiri'] });
    expect(toolCall?.headers.get('Mcp-Session-Id')).toBe('session-1');
    const ollama = calls.find(call => call.url.endsWith('/api/chat'));
    expect(ollama?.body.tools.map((tool: any) => tool.function.name)).toEqual(['search_vector', 'read_text']);
    const toolDescriptions = Object.fromEntries(ollama?.body.tools.map((tool: any) => [tool.function.name, tool.function.description]) || []);
    expect(toolDescriptions.search_vector).toMatch(/semantic discovery/i);
    expect(toolDescriptions.search_vector).toMatch(/whole corpus/i);
    expect(toolDescriptions.read_text).toMatch(/surrounding context/i);
    expect(ollama?.body.model).toBe('qwen3.5:9b');
    expect(ollama?.body.stream).toBe(false);
    expect(ollama?.body.messages[0].content).toMatch(/search_vector.*search_lucene.*search_grep/s);
    expect(ollama?.body.messages[0].content).toMatch(/exactly one already identified work/i);
    expect(ollama?.body.messages.at(-1)).toMatchObject({ role: 'user', content: 'Unde merge Nică?' });
    expect(ollama?.headers.get('authorization')).toBeNull();
    expect(calls.find(call => call.body?.method === 'notifications/initialized')?.body.id).toBeUndefined();
    const finalOllama = calls.filter(call => call.url.endsWith('/api/chat')).at(-1);
    expect(finalOllama?.body.messages.some((message: any) => message.role === 'tool' && message.content.includes('Nică merge la școală.'))).toBe(true);
  });

  it('does not allow literal grep outside an active work', async () => {
    process.env.BIBLIOTECA_INTERNAL_API_TOKEN = 'test-token';
    const clientCalls: any[] = [];
    let round = 0;
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      clientCalls.push({ url, body });
      if (url.endsWith('/mcp')) {
        if (body.method === 'initialize') return response({ result: {} }, { 'mcp-session-id': 's' });
        if (body.method === 'notifications/initialized') return response({}, { 'mcp-session-id': 's' });
        if (body.method === 'tools/list') return response({ result: { tools: [{ name: 'search_grep', inputSchema: { type: 'object' } }] } });
        if (body.method === 'tools/call') throw new Error('grep must not reach MCP');
      }
      if (!url.endsWith('/api/chat')) throw new Error(`unexpected URL ${url}`);
      round += 1;
      return response({ message: round === 1
        ? { role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_grep', arguments: { q: 'pebbles' } } }] }
        : { role: 'assistant', content: 'I could not perform a global literal scan.' } });
    }) as typeof fetch;

    const service = new McpChatService({ bibliotecaUrl: 'http://server:8080', ollamaUrl: 'http://ollama' } as any);
    const result = await service.chat('Find the exact word pebbles.');
    expect(result.answer).toContain('could not perform');
    expect(clientCalls.some(call => call.body?.method === 'tools/call')).toBe(false);
  });

  it('does not allow literal grep across a multi-work scope', async () => {
    process.env.BIBLIOTECA_INTERNAL_API_TOKEN = 'test-token';
    const clientCalls: any[] = [];
    let round = 0;
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      clientCalls.push({ url, body });
      if (url.endsWith('/mcp')) {
        if (body.method === 'initialize') return response({ result: {} }, { 'mcp-session-id': 's' });
        if (body.method === 'notifications/initialized') return response({}, { 'mcp-session-id': 's' });
        if (body.method === 'tools/list') return response({ result: { tools: [{ name: 'search_grep', inputSchema: { type: 'object' } }] } });
        if (body.method === 'tools/call') throw new Error('grep must not reach MCP');
      }
      if (!url.endsWith('/api/chat')) throw new Error(`unexpected URL ${url}`);
      round += 1;
      return response({ message: round === 1
        ? { role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_grep', arguments: { q: 'pebbles' } } }] }
        : { role: 'assistant', content: 'I could not perform a cross-work literal scan.' } });
    }) as typeof fetch;

    const service = new McpChatService({ bibliotecaUrl: 'http://server:8080', ollamaUrl: 'http://ollama' } as any);
    const result = await service.chat('Find the exact word pebbles.', { scope: { opusPaths: ['frazer/work', 'comnena/work'] } });
    expect(result.answer).toContain('cross-work');
    expect(clientCalls.some(call => call.body?.method === 'tools/call')).toBe(false);
  });
});
