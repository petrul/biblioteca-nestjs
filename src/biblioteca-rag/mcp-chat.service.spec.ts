/// <reference types="jest" />
import { Logger } from '@nestjs/common';
import { McpChatService } from './mcp-chat.service';

function response(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
}

describe('McpChatService', () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.BIBLIOTECA_INTERNAL_API_TOKEN;

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.BIBLIOTECA_INTERNAL_API_TOKEN;
    else process.env.BIBLIOTECA_INTERNAL_API_TOKEN = originalToken;
  });

  it('discovers Biblioteca tools, executes Qwen tool calls, and keeps a work scope', async () => {
    process.env.BIBLIOTECA_INTERNAL_API_TOKEN = 'test-token';
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
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
    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines.some(line => line.includes('question=') && line.includes('Unde merge Nică?'))).toBe(true);
    expect(lines.some(line => line.includes('tool=search_vector args='))).toBe(true);
    expect(lines.some(line => line.includes('tool=search_vector result=passages=1'))).toBe(true);
    expect(lines.some(line => line.includes('complete answer_chars=') && line.includes('refs=https://biblioteca.test/creanga/amintiri/p1'))).toBe(true);
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

  it('requires complementary global search and source reading before a final answer', async () => {
    process.env.BIBLIOTECA_INTERNAL_API_TOKEN = 'test-token';
    const calls: Array<{ url: string; body: any }> = [];
    let ollamaRound = 0;
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.endsWith('/mcp')) {
        if (body.method === 'initialize') return response({ result: {} }, { 'mcp-session-id': 'search-session' });
        if (body.method === 'notifications/initialized') return response({}, { 'mcp-session-id': 'search-session' });
        if (body.method === 'tools/list') return response({ result: { tools: [
          { name: 'search_vector', inputSchema: { type: 'object' } },
          { name: 'search_lucene', inputSchema: { type: 'object' } },
          { name: 'read_text', inputSchema: { type: 'object' } },
        ] } });
        if (body.method === 'tools/call') return response({ result: { structuredContent: [
          { type: 'milvus', url: 'https://biblioteca.test/comnena/alexiada/cartea_a_viii_a', content: 'Cuvinte despre cumani și războiul bizantin.' },
        ] } });
      }
      if (url.endsWith('/api/chat')) {
        ollamaRound += 1;
        if (ollamaRound === 1) return response({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_vector', arguments: { q: 'cumani în Alexiada' } } }] } });
        if (ollamaRound === 2) return response({ message: { role: 'assistant', content: 'Am găsit piste semantice.' } });
        if (ollamaRound === 3) return response({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_lucene', arguments: { q: 'cumani Alexiada' } } }] } });
        if (ollamaRound === 4) return response({ message: { role: 'assistant', content: 'Am găsit rezultate de căutare.' } });
        if (ollamaRound === 5) return response({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_text', arguments: { path: 'comnena/alexiada/cartea_a_viii_a' } } }] } });
        return response({ message: { role: 'assistant', content: 'În Alexiada, pasajul descrie conflictul cu cumanii și războiul bizantin.' } });
      }
      throw new Error(`unexpected URL ${url}`);
    }) as typeof fetch;

    const service = new McpChatService({ bibliotecaUrl: 'http://server:8080', ollamaUrl: 'http://ollama' } as any);
    const result = await service.chat('În Alexiada ai găsit ceva despre cumani?');
    expect(result.answer).toContain('Alexiada');
    expect(calls.filter(call => call.body?.method === 'tools/call').map(call => call.body.params.name)).toEqual(['search_vector', 'search_lucene', 'read_text']);
    const repairPrompts = calls.filter(call => call.url.endsWith('/api/chat')).flatMap(call => call.body.messages.filter((message: any) => message.role === 'user').map((message: any) => message.content));
    expect(repairPrompts.some((prompt: string) => /complementary global search/i.test(prompt))).toBe(true);
    expect(repairPrompts.some((prompt: string) => /Search results are leads/i.test(prompt))).toBe(true);
  });

  it('repairs a continuation promise by reading the promising source before answering', async () => {
    process.env.BIBLIOTECA_INTERNAL_API_TOKEN = 'test-token';
    const calls: Array<{ url: string; body: any }> = [];
    let ollamaRound = 0;
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.endsWith('/mcp')) {
        if (body.method === 'initialize') return response({ result: {} }, { 'mcp-session-id': 'continuation-session' });
        if (body.method === 'notifications/initialized') return response({}, { 'mcp-session-id': 'continuation-session' });
        if (body.method === 'tools/list') return response({ result: { tools: [
          { name: 'search_vector', description: 'semantic search', inputSchema: { type: 'object' } },
          { name: 'read_text', description: 'read text', inputSchema: { type: 'object' } },
        ] } });
        if (body.method === 'tools/call') {
          const name = body.params.name;
          const content = name === 'read_text'
            ? 'Poghiazul cumanilor este descris în detaliu: atacul ajunge la mănăstire, iar apărătorii se retrag.'
            : 'Un poghiaz al cumanilor atacă o mănăstire.';
          return response({ result: { structuredContent: [
            { type: 'milvus', url: 'https://biblioteca.test/stratulat/sub_semnul_palosului/poghiazul_cumanilor', content },
          ] } });
        }
      }
      if (url.endsWith('/api/chat')) {
        ollamaRound += 1;
        if (ollamaRound === 1) return response({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_vector', arguments: { q: 'scene cu cumani în război' } } }] } });
        if (ollamaRound === 2) return response({ message: { role: 'assistant', content: 'Am găsit un text relevant. Să citesc acest fragment pentru detalii?' } });
        if (ollamaRound === 3) return response({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_text', arguments: { path: 'stratulat/sub_semnul_palosului/poghiazul_cumanilor' } } }] } });
        return response({ message: { role: 'assistant', content: 'În fragment, cumanii atacă mănăstirea, iar apărătorii se retrag.' } });
      }
      throw new Error(`unexpected URL ${url}`);
    }) as typeof fetch;

    const service = new McpChatService({ bibliotecaUrl: 'http://server:8080', ollamaUrl: 'http://ollama' } as any);
    const result = await service.chat('Scene cu Cumani în război');

    expect(result.answer).toContain('cumanii atacă mănăstirea');
    expect(result.answer).not.toMatch(/să citesc|doriți să/i);
    expect(calls.filter(call => call.body?.method === 'tools/call').map(call => call.body.params.name)).toEqual(['search_vector', 'read_text']);
    const repairedPrompt = calls.filter(call => call.url.endsWith('/api/chat')).at(2)?.body.messages.at(-1)?.content;
    expect(repairedPrompt).toMatch(/Nu încheia cu o promisiune de continuare/i);
    expect(repairedPrompt).toMatch(/citește-o acum/i);
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
