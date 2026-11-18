import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
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
const CONTINUATION_PROMISE = /\b(?:să\s+(?:citesc|citim|văd|verific)|pot\s+să\s+(?:citesc|văd|verific)|trebuie\s+să\s+(?:caut|citesc|verific)|voi\s+(?:căuta|citi|verifica)|doriți\s+să|would\s+you\s+like\s+me\s+to|shall\s+i\s+(?:read|look)|i\s+(?:can|need|will)\s+to\s+(?:read|look|search))\b/i;
const EVIDENCE_TOOLS = new Set(['read_text', 'div_by_path', 'div_paragraphs']);

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
  private readonly log = new Logger(McpChatService.name);

  constructor(@Inject(PROVIDER_CONF) private readonly conf: VectorizerConfiguration) {}

  async chat(message: string, request: McpChatRequest = {}): Promise<RagChatResponse> {
    const conversationId = request.conversationId || randomUUID();
    const scope = normalizedScope(request.scope);
    const trace = conversationId.slice(0, 8);
    this.log.log(`[chat:${trace}] question=${oneLine(message)} scope=${scope.opusPaths?.join(',') || 'library'}`);
    const history = await this.conversations.history(conversationId);
    const client = new McpClient(this.conf.bibliotecaUrl, process.env.BIBLIOTECA_INTERNAL_API_TOKEN || '');
    await client.initialize();
    const advertised = await client.tools();
    const selected = advertised.filter(tool => DEFAULT_TOOLS.has(tool.name));
    if (!selected.length) throw new Error('Biblioteca MCP advertised no chat tools');
    this.log.log(`[chat:${trace}] MCP tools=${selected.map(tool => tool.name).join(',')}`);

    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt(scope) },
      ...history.map(turn => ({ role: turn.role, content: turn.content } as OllamaMessage)),
      { role: 'user', content: message },
    ];
    const tools = selected.map(toolDefinition);
    const selectedNames = new Set(selected.map(tool => tool.name));
    const calledTools = new Set<string>();
    let usedTool = false;
    let attemptedTool = false;
    let answer = '';
    let lastAnswerCandidate = '';
    const observed: unknown[] = [];
    let continuationRepairRequested = false;
    let searchRepairRequested = false;
    let evidenceRepairRequested = false;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const completion = await this.ollama(messages, tools);
      const assistant = completion.message || {};
      const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
      const content = typeof assistant.content === 'string' ? assistant.content : '';
      if (content.trim()) lastAnswerCandidate = content.trim();
      this.log.log(`[chat:${trace}] round=${round + 1} qwen tool_calls=${calls.length ? calls.map(call => call?.function?.name || '(unnamed)').join(',') : 'none'} answer_chars=${content.length}`);
      messages.push({ role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) });

      if (!calls.length) {
        const hasSemanticSearch = calledTools.has('search_vector');
        const hasKeywordSearch = calledTools.has('search_lucene');
        const missingGlobalSearch = !scope.opusPaths?.length && selectedNames.has('search_vector') && selectedNames.has('search_lucene')
          ? (hasSemanticSearch ? (!hasKeywordSearch ? 'search_lucene' : null) : 'search_vector')
          : null;
        if (usedTool && missingGlobalSearch && !searchRepairRequested) {
          searchRepairRequested = true;
          this.log.log(`[chat:${trace}] repair=global-complement missing=${missingGlobalSearch}`);
          messages.push({ role: 'user', content: `Complete the evidence pass before answering: call ${missingGlobalSearch} now as the complementary global search, compare its results with the searches already run, then continue to source reading.` });
          continue;
        }
        if (usedTool && CONTINUATION_PROMISE.test(content) && !continuationRepairRequested) {
          continuationRepairRequested = true;
          evidenceRepairRequested = true;
          this.log.log(`[chat:${trace}] repair=continuation-promise`);
          messages.push({ role: 'user', content: 'Nu încheia cu o promisiune de continuare. Dacă ai identificat o sursă relevantă, citește-o acum folosind read_text sau div_by_path, apoi răspunde complet în acest tur. Nu întreba dacă doresc să continui.' });
          continue;
        }
        if (usedTool && [...calledTools].some(name => SEARCH_TOOLS.has(name)) && ![...calledTools].some(name => EVIDENCE_TOOLS.has(name)) && !evidenceRepairRequested) {
          evidenceRepairRequested = true;
          this.log.log(`[chat:${trace}] repair=search-without-evidence`);
          messages.push({ role: 'user', content: 'Search results are leads, not evidence. Before answering, call read_text or div_by_path on the most relevant stable path and ground the answer in the returned text.' });
          continue;
        }
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
          this.log.log(`[chat:${trace}] tool=${name} args=${safeJson(scoped)}`);
          const result = await client.call(name, scoped);
          usedTool = true;
          calledTools.add(name);
          observed.push(result);
          this.log.log(`[chat:${trace}] tool=${name} result=${summarizeToolResult(result)}`);
          messages.push({ role: 'tool', content: compact(result) });
        } catch (error: any) {
          this.log.warn(`[chat:${trace}] tool=${name} failed=${oneLine(error?.message || String(error))}`);
          messages.push({ role: 'tool', content: JSON.stringify({ error: error?.message || String(error) }) });
        }
      }
    }
    if (!answer) {
      // A model can spend the whole tool budget correcting a bad path or
      // promising one more read.  Do not turn that into a chat outage: ask
      // once for a final answer from the evidence already collected, with no
      // tools left to call.  The valid tool results are still in `messages`,
      // while failed calls are explicitly marked as errors there.
      this.log.warn(`[chat:${trace}] rounds-exhausted; requesting final synthesis from collected evidence`);
      try {
        const final = await this.ollama([
          ...messages,
          { role: 'user', content: 'Give the final answer now from the valid evidence already collected. Do not call tools, do not promise to continue, and do not ask whether I want more. Cite the stable Biblioteca paths you can support.' },
        ], []);
        const finalContent = typeof final.message?.content === 'string' ? final.message.content.trim() : '';
        if (finalContent) answer = finalContent;
      } catch (error: any) {
        this.log.warn(`[chat:${trace}] final synthesis failed=${oneLine(error?.message || String(error))}`);
      }
    }
    // If the final synthesis itself failed, preserve the model's last useful
    // text rather than presenting a misleading "server unavailable" error.
    if (!answer && lastAnswerCandidate) answer = lastAnswerCandidate;
    if (!answer) throw new Error(`Ollama did not finish a grounded answer after ${MAX_ROUNDS} rounds`);
    const finalPassages = passages(observed);
    // Qwen can cite a passage number from an intermediate search set that is
    // not present in the compact response returned to the reader. Never
    // expose a dangling citation that the UI cannot make openable.
    answer = sanitizeCitationMarkers(answer, finalPassages.length);
    const finalRefs = [...new Set(finalPassages.map(p => p.url))].slice(0, 8);
    this.log.log(`[chat:${trace}] complete answer_chars=${answer.length} tools=${[...calledTools].join(',') || 'none'} passages=${finalPassages.length} refs=${finalRefs.join(' | ') || 'none'} answer_preview=${oneLine(answer, 500)}`);
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
      passages: finalPassages,
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
    'Use the supplied Biblioteca MCP tools before making factual claims. Follow this search discipline: for a broad or global question, call both search_vector for meaning and search_lucene for names/keywords, compare their stable paths and excerpts, then use div_by_path or read_text to inspect the surrounding chapter. For a question about a named work, pass that work as a scope when possible or constrain both searches to its stable path. Use div_toc or div_paragraphs when navigation or paragraph-level evidence is needed. Use search_grep only as a final exact-phrase check inside exactly one already identified work, never for global discovery. Use quote_fragment only when you have a verified division path and quote boundaries.',
    'Complete every turn in one response. Never promise to read or search something later, and never end with "shall I continue?" If a search finds a promising source, immediately call read_text or div_by_path in this same turn before answering; if it cannot be opened, say that plainly instead of offering a future continuation.',
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

function oneLine(value: unknown, max = 500): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  const clipped = text.length > max ? `${text.slice(0, max - 1)}…` : text;
  return JSON.stringify(clipped);
}

function safeJson(value: unknown, max = 1000): string {
  try { return oneLine(JSON.stringify(value), max); } catch { return '"[unserializable]"'; }
}

export function sanitizeCitationMarkers(answer: string, passageCount: number): string {
  return answer.replace(/\[(\d+)\]/g, (marker, number) => {
    const index = Number(number);
    return index >= 1 && index <= passageCount ? marker : '';
  }).replace(/[ \t]{2,}/g, ' ').trim();
}

function summarizeToolResult(value: unknown): string {
  const found = passages([value]);
  if (found.length) {
    const refs = found.slice(0, 6).map(p => `${p.url} :: ${oneLine(p.text, 180)}`).join(' | ');
    return `passages=${found.length} ${refs}`;
  }
  return `payload=${oneLine(value, 900)}`;
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
