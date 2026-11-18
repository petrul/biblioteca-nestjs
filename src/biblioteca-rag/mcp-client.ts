/**
 * Minimal streamable-HTTP MCP client.
 *
 * Ollama does not speak MCP itself. This client performs the small amount of
 * protocol work needed by the chat adaptor: initialize a session, discover
 * tools, and call those tools while keeping the session id on every request.
 */

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

type JsonRpcResult = {
  result?: Record<string, any>;
  error?: { message?: string; code?: number };
};

function endpointFrom(base: string): string {
  const raw = String(base || '').replace(/\/+$/, '');
  if (!raw) throw new Error('BIBLIOTECA_EXTERNAL_URL is required for MCP chat');
  return raw.endsWith('/mcp') ? raw : `${raw}/mcp`;
}

export class McpClient {
  private sessionId: string | undefined;
  private nextId = 1;
  private readonly endpoint: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 120_000,
  ) {
    if (!token.trim()) throw new Error('BIBLIOTECA_INTERNAL_API_TOKEN is required for MCP chat');
    this.endpoint = endpointFrom(baseUrl);
  }

  async initialize(): Promise<void> {
    const response = await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'biblioteca-nestjs-chat', version: '0.1' },
    }, false);
    if (!response.result) throw new Error('MCP initialize returned no result');
    // Streamable HTTP MCP requires the client to acknowledge the handshake
    // before it starts listing or calling tools.
    await this.rpc('notifications/initialized', {});
  }

  async tools(): Promise<McpTool[]> {
    const response = await this.rpc('tools/list', {});
    const tools = response.result?.tools;
    if (!Array.isArray(tools)) throw new Error('MCP tools/list returned no tools');
    return tools.filter((tool): tool is McpTool => typeof tool?.name === 'string');
  }

  async call(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    const response = await this.rpc('tools/call', { name, arguments: arguments_ });
    if (response.error) throw new Error(response.error.message || `MCP tool ${name} failed`);
    const result = response.result || {};
    if (result.isError) throw new Error(mcpContentText(result.content) || `MCP tool ${name} failed`);
    if (result.structuredContent !== undefined) return result.structuredContent;
    const content = mcpContentText(result.content);
    if (!content) return result;
    try { return JSON.parse(content); } catch { return content; }
  }

  private async rpc(method: string, params: Record<string, unknown>, withSession = true): Promise<JsonRpcResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      };
      if (withSession && this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
      const body = {
        jsonrpc: '2.0' as const,
        ...(method.startsWith('notifications/') ? {} : { id: this.nextId++ }),
        method,
        params,
      };
      const response = await fetch(this.endpoint, {
        method: 'POST', headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const session = response.headers.get('mcp-session-id');
      if (session) this.sessionId = session;
      const text = await response.text();
      if (!response.ok) throw new Error(`MCP ${response.status}: ${text.slice(0, 500)}`);
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        const events = text.split(/\r?\n\r?\n/).flatMap(event => event.split(/\r?\n/))
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())
          .filter(Boolean);
        const last = events.at(-1);
        if (!last) throw new Error('MCP returned an empty event stream');
        return JSON.parse(last) as JsonRpcResult;
      }
      if (!text.trim()) return {};
      return JSON.parse(text) as JsonRpcResult;
    } catch (error: any) {
      if (error?.name === 'AbortError') throw new Error(`MCP request timed out after ${this.timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function mcpContentText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.filter(item => item?.type === 'text' && typeof item.text === 'string')
    .map(item => item.text).join('\n');
}
