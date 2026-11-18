import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { VectorizerConfiguration, PROVIDER_CONF } from '../configuration';
import { MemoryConversationStore } from '../ragtime/core';
import { McpClient, McpTool } from './mcp-client';
import { BibliotecaScope } from './biblioteca.source';
import type { RagChatResponse, RagPassage } from './rag.service';

export const PROVIDER_MCP_CHAT = Symbol('McpChatService');
const MODEL = 'qwen3.5:9b';
const MAX_ROUNDS = 6;
const MAX_TOOL_RESULT_CHARS = 12_000;

const DEFAULT_TOOLS = new Set([
  'search_authors', 'search_div_heads', 'search_lucene', 'search_grep', 'search_vector', 'search_ann',
  'div_by_path', 'div_toc', 'div_paragraphs', 'read_text', 'quote_fragment',
  'works_catalog', 'author_details', 'author_works',
]);
const SEARCH_TOOLS = new Set(['search_div_heads', 'search_lucene', 'search_grep', 'search_vector']);
const PATH_TOOLS: Record<string, string[]> = {
  div_by_path: ['path'],
  read_text: ['path'],
  quote_fragment: ['divPath'],
  search_ann: ['path'],
};

/**
 * The MCP server remains the source of truth for schemas and execution, but a
 * model benefits from a compact, task-oriented explanation of when each tool
 * is useful. In particular, these descriptions teach Qwen the progression
 * from broad discovery to narrow textual verification instead of presenting
 * six search functions as interchangeable buttons.
 */
const TOOL_GUIDANCE: Record<string, string> = {
  search_vector: 'Semantic discovery over the whole corpus (or the supplied scope). Start here for concepts, themes, paraphrases and questions whose wording may not occur verbatim. It returns candidate division paths and passages; use its paths with read_text or div_by_path to inspect evidence. For a broad library question, run this globally before narrowing.',
  search_lucene: 'Full-text keyword search over the whole corpus (or the supplied scope), with language-aware stemming. Use it alongside or after search_vector for names, proper nouns, distinctive terms and alternate keywords. It returns ranked hits with excerpts and stable paths; inspect promising hits with read_text or div_by_path rather than treating the hit list as a complete answer.',
  search_grep: 'Exact, case-insensitive literal substring search with no stemming or semantic expansion. Use only when exactly one active work is in scope, normally after vector/Lucene search has identified the work and you need to verify a phrase or spelling. Never use this as a global discovery tool; without one active work it will be refused.',
  search_div_heads: 'Search chapter and section headings. Use it to map a work\'s structure or find a likely chapter after semantic/keyword discovery; it is a locator, not evidence for the final answer.',
  search_authors: 'Find authors by name substring and obtain their stable author ids. Use this for author-oriented questions or before author_details/author_works; do not infer an author from a title alone.',
  search_ann: 'Find divisions semantically similar to one already identified division. Use only as a follow-up exploration tool with a stable path or numeric division id; it is not the first search for a free-form library question.',
  div_by_path: 'Resolve a stable author/opus/... path to one work division or paragraph and its metadata. Call this after a search hit when you need an id, title, chapter context or a precise path for the next read.',
  div_toc: 'List the child divisions in book order for a numeric division id obtained from div_by_path or a search/catalog hit. Use it to navigate a chapter tree; do not guess numeric ids.',
  div_paragraphs: 'List the paragraphs of a numeric division, optionally with their text. Use it after div_by_path/div_toc when you need paragraph-level evidence or to inspect a small, specific section; page through results instead of assuming the first page is complete.',
  read_text: 'Read a division by its stable path as plain text (or explicitly requested XML/JSON). Use it to gather surrounding context for search hits, with depth when a whole chapter or nested section is needed. Keep the active work scope and never invent a path.',
  quote_fragment: 'Read an exact paragraph/character-range quotation inside one identified division. Use it only after finding the source path and valid dot-path boundaries; it is for precise quotation and checking, not discovery.',
  works_catalog: 'Page through root works, optionally filtered by title or language. Use it for catalogue/discovery questions when search results are insufficient; never assume the catalogue is a single unpaged response.',
  author_details: 'Retrieve one author\'s metadata and work list by stable author id. Use after search_authors or when the id is already known.',
  author_works: 'Retrieve the root works for one known stable author id. Use after author discovery to enumerate that author\'s corpus before searching or reading it.',
};

export interface McpChatRequest {
  scope?: BibliotecaScope;
  conversationId?: string;
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

/** Thin MCP-to-Ollama chat adaptor. It owns no retrieval logic of its own. */
@Injectable()
export class McpChatService {
  private readonly conversations = new MemoryConversationStore({ maxConversations: 1000, maxTurns: 40 });

  constructor(@Inject(PROVIDER_CONF) private readonly conf: VectorizerConfiguration) {}

  async chat(message: string, request: McpChatRequest = {}): Promise<RagChatResponse> {
    const conversationId = request.conversationId || randomUUID();
    const scope = normalizedScope(request.scope);
    const history = await this.conversations.history(conversationId);
    const client = new McpClient(this.conf.bibliotecaUrl, process.env.BIBLIOTECA_INTERNAL_API_TOKEN || '');
    await client.initialize();
    const advertised = await client.tools();
    const selected = advertised.filter(tool => DEFAULT_TOOLS.has(tool.name));
    if (!selected.length) throw new Error('Biblioteca MCP advertised no chat tools');

    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt(scope) },
      ...history.map(turn => ({ role: turn.role, content: turn.content } as OllamaMessage)),
      { role: 'user', content: message },
    ];
    const tools = selected.map(toolDefinition);
    let usedTool = false;
    let attemptedTool = false;
    let answer = '';
    const observed: unknown[] = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const completion = await this.ollama(messages, tools);
      const assistant = completion.message || {};
      const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
      const content = typeof assistant.content === 'string' ? assistant.content : '';
      messages.push({ role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) });

      if (!calls.length) {
        if (usedTool || attemptedTool) {
          answer = content.trim();
          break;
        }
        // Qwen can occasionally answer from its weights on the first turn;
        // make corpus grounding an explicit protocol requirement.
        messages.push({ role: 'user', content: 'Before answering, call at least one Biblioteca corpus tool and use its result.' });
        continue;
      }

      for (const call of calls) {
        attemptedTool = true;
        const name = call?.function?.name;
        if (!name || !selected.some(tool => tool.name === name)) {
          messages.push({ role: 'tool', content: JSON.stringify({ error: `Tool ${name || '(unnamed)'} was not advertised by Biblioteca MCP` }) });
          continue;
        }
        let args: Record<string, unknown>;
        try {
          args = typeof call.function.arguments === 'string'
            ? JSON.parse(call.function.arguments) as Record<string, unknown>
            : (call.function.arguments || {});
        } catch {
          messages.push({ role: 'tool', content: JSON.stringify({ error: 'tool arguments were not valid JSON' }) });
          continue;
        }
        try {
          const scoped = enforceScope(name, args, scope);
          const result = await client.call(name, scoped);
          usedTool = true;
          observed.push(result);
          messages.push({ role: 'tool', content: compact(result) });
        } catch (error: any) {
          messages.push({ role: 'tool', content: JSON.stringify({ error: error?.message || String(error) }) });
        }
      }
    }
    if (!answer) throw new Error(`Ollama did not finish a grounded answer after ${MAX_ROUNDS} rounds`);
    await this.conversations.append(conversationId, [
      { role: 'user', content: message },
      { role: 'assistant', content: answer },
    ]);
    return {
      conversationId,
      message,
      question: message,
      scope,
      answer,
      model: MODEL,
      passages: passages(observed),
    };
  }

  private async ollama(messages: OllamaMessage[], tools: unknown[]): Promise<any> {
    const base = this.conf.ollamaUrl.replace(/\/+$/, '');
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        think: false,
        keep_alive: '6h',
        options: { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0, repeat_penalty: 1.2, num_ctx: 8192, num_predict: 4096 },
        messages,
        tools,
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) throw new Error(`Ollama chat failed: HTTP ${response.status} ${await response.text()}`);
    const payload = await response.json() as any;
    if (!payload.message) throw new Error('Ollama chat returned no message');
    return payload;
  }
}

function toolDefinition(tool: McpTool): unknown {
  const guidance = TOOL_GUIDANCE[tool.name];
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: guidance || tool.description || `Biblioteca tool ${tool.name}`,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
    },
  };
}

function normalizedScope(scope?: BibliotecaScope): BibliotecaScope {
  const paths = scope?.opusPaths;
  if (!paths) return {};
  if (!Array.isArray(paths) || paths.length === 0 || paths.some(path => typeof path !== 'string' || !/^[^/]+\/[^/]+$/.test(path.replace(/^\/+|\/+$/g, ''))))
    throw new BadRequestException('scope.opusPaths must contain author/opus paths');
  return { opusPaths: paths.map(path => path.replace(/^\/+|\/+$/g, '')) };
}

function systemPrompt(scope: BibliotecaScope): string {
  const active = scope.opusPaths?.length ? `The active work scope is ${scope.opusPaths.join(', ')}. Never retrieve outside it.` : 'There is no active work scope: search the whole library.';
  return [
    'You are Biblioteca\'s master librarian, answering from its classical, historical and philosophical corpus.',
    active,
    'Use the supplied Biblioteca MCP tools before making factual claims. Follow this search discipline: for a broad or global question, begin with search_vector for meaning and search_lucene for names/keywords, using both when useful; compare their stable paths and excerpts. Then use div_by_path or read_text to inspect the surrounding chapter, and use div_toc or div_paragraphs when navigation or paragraph-level evidence is needed. Use search_grep only as a final exact-phrase check inside exactly one already identified work, never for global discovery. Use quote_fragment only when you have a verified division path and quote boundaries.',
    'Do not invent books, passages, authors, or search results. Answer in the language of the question, be concise unless asked for a detailed literary comment, and cite stable author/opus paths when relevant.',
  ].join(' ');
}

function enforceScope(name: string, args: Record<string, unknown>, scope: BibliotecaScope): Record<string, unknown> {
  const paths = scope.opusPaths || [];
  if (name === 'search_grep' && paths.length !== 1) throw new Error('search_grep requires exactly one active work scope');
  if (!paths.length) return args;
  if (SEARCH_TOOLS.has(name)) {
    const requested = args.scope;
    if (requested !== undefined && JSON.stringify(requested) !== JSON.stringify(paths)) throw new Error('tool scope would leave the active work');
    return { ...args, scope: paths };
  }
  if (name === 'div_toc' || name === 'div_paragraphs') throw new Error(`${name} requires a scoped path before numeric lookup`);
  for (const key of PATH_TOOLS[name] || []) {
    const value = args[key];
    if (typeof value === 'string' && !paths.some(path => value === path || value.startsWith(`${path}/`))) throw new Error('tool path would leave the active work');
  }
  return args;
}

function compact(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[tool result truncated]` : text;
}

function passages(values: unknown[]): RagPassage[] {
  const output: RagPassage[] = [];
  const visit = (value: unknown) => {
    if (output.length >= 12 || !value) return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value !== 'object') return;
    const item = value as Record<string, any>;
    if (typeof item.url === 'string' && (typeof item.content === 'string' || typeof item.text === 'string')) {
      const clean = item.url.replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '');
      output.push({
        n: output.length + 1,
        url: item.url,
        opusPath: clean.split('/').slice(0, 2).join('/'),
        ...(typeof item.content === 'string' ? { text: item.content } : { text: item.text }),
        ...(typeof item.score === 'number' ? { score: item.score, scoreKind: item.type === 'lucene' ? 'similarity' : 'distance' } : { score: 0, scoreKind: 'similarity' }),
      });
    }
    Object.values(item).forEach(visit);
  };
  values.forEach(visit);
  return output;
}
