import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { BibliotecaClient } from "../services/biblioteca_client.service";
import {
    ChatModel,
    ChatTurn,
    DEFAULT_SYSTEM_PROMPT,
    DefaultPromptBuilder,
    Embedder,
    GenericSearcher,
    LlmQueryRewriter,
    MemoryConversationStore,
    PromptedGenerator,
    RagChatbot,
    RagtimeSystem,
    SearchResultItem,
    VectorFilter,
} from "../ragtime/core";
import {
    BibliotecaContentResolver,
    BibliotecaContextExpander,
    BibliotecaParagraph,
    BibliotecaScope,
    bibliotecaFilter,
} from "./biblioteca.source";
import { BibliotecaVectorCollection, PROVIDER_CHAT_MODEL, PROVIDER_EMBEDDER, PROVIDER_VECTOR_COLLECTION } from "./ragtime.providers";

export interface RagPassage {
    /** 1-based: the [n] the answer cites. */
    n: number;
    url: string;
    opusPath: string;
    /** "Author, Work - Chapter". */
    title?: string;
    language?: string;
    text: string;
    /** Euclid distance to the question: lower is closer. */
    score: number;
}

export interface RagSearchResponse {
    query: string;
    scope: BibliotecaScope;
    passages: RagPassage[];
}

export interface RagAnswerResponse {
    question: string;
    scope: BibliotecaScope;
    /** Empty when no passage of the scope was found: nothing is generated then. */
    answer: string;
    model: string | null;
    passages: RagPassage[];
}

export interface RagChatResponse extends RagAnswerResponse {
    conversationId: string;
    /** The message as sent; `question` is what was searched for (rewritten from the conversation). */
    message: string;
}

export interface RagRequestBase {
    scope?: BibliotecaScope;
    topK?: number;
    /** Euclid distance above which a passage is too far to use. */
    maxDistance?: number;
}

export const RAG_LIMITS = Object.freeze({
    minQueryChars: 3,
    maxQueryChars: 2000,
    maxSearchTopK: 50,
    maxAskTopK: 12,
    maxOpusPaths: 500,
    maxHistoryTurns: 20,
    maxTurnChars: 8000,
});

export const BIBLIOTECA_SYSTEM_PROMPT = [
    'You are the reading companion of Biblioteca, a digital library of literary, historical and philosophical works.',
    'The numbered passages come from its books; each one names its author, work and chapter.',
    DEFAULT_SYSTEM_PROMPT,
    'Be concise: a few sentences, unless asked for more. Quote short phrases from the passages when they help.',
].join(' ');

/**
 * Passages shorter than this are never results: an exclamation or a line of
 * dialogue ("Crrr... Crrr...") embeds near almost any query and says nothing.
 */
export const MIN_PASSAGE_CHARS = 80;

/**
 * Semantic search, RAG and chat over Biblioteca's paragraph vectors, scoped
 * to one work ("chat with a book"), several (a collection) or the whole
 * library. Composes ragtime's generic searcher, RAG system and chatbot with
 * the Biblioteca resolver and context expander; the stores and models come
 * in through the providers.
 */
@Injectable()
export class RagService {
    private readonly searcher: GenericSearcher<BibliotecaParagraph>;
    private readonly rag: RagtimeSystem<BibliotecaParagraph>;
    private readonly chatbot: RagChatbot<BibliotecaParagraph>;

    constructor(
        tbc: BibliotecaClient,
        @Inject(PROVIDER_EMBEDDER) embedder: Embedder,
        @Inject(PROVIDER_VECTOR_COLLECTION) private readonly vectors: BibliotecaVectorCollection,
        @Inject(PROVIDER_CHAT_MODEL) private readonly chatModel: ChatModel,
    ) {
        const resolver = new BibliotecaContentResolver(tbc);
        this.searcher = new GenericSearcher(embedder, vectors.store, resolver, {
            accept: (paragraph) => paragraph.text.trim().length >= MIN_PASSAGE_CHARS,
        });
        const generator = new PromptedGenerator(chatModel, new DefaultPromptBuilder({ systemPrompt: BIBLIOTECA_SYSTEM_PROMPT }));
        this.rag = new RagtimeSystem(this.searcher, generator, { expander: new BibliotecaContextExpander(resolver) });
        this.chatbot = new RagChatbot(this.rag, new MemoryConversationStore(), { rewriter: new LlmQueryRewriter(chatModel) });
    }

    async search(query: string, request: RagRequestBase = {}): Promise<RagSearchResponse> {
        const q = validQuery(query);
        const filter = validFilter(request.scope);
        const { results } = await this.searcher.search(q, this.vectors.name, {
            topK: validTopK(request.topK ?? 10, RAG_LIMITS.maxSearchTopK), filter, scoreThreshold: validDistance(request.maxDistance),
        });
        return { query: q, scope: scopeOf(filter), passages: passages(results) };
    }

    async ask(question: string, request: RagRequestBase & { history?: ChatTurn[] } = {}): Promise<RagAnswerResponse> {
        const q = validQuery(question);
        const filter = validFilter(request.scope);
        const response = await this.rag.ask(q, this.vectors.name, {
            topK: validTopK(request.topK ?? 6, RAG_LIMITS.maxAskTopK), filter, scoreThreshold: validDistance(request.maxDistance),
            history: validHistory(request.history),
        });
        return {
            question: q,
            scope: scopeOf(filter),
            answer: response.answer,
            model: response.citations.length > 0 ? this.chatModel.modelName : null,
            passages: passages(response.citations),
        };
    }

    /** The passages, then the answer as it is generated. */
    async streamAsk(question: string, request: RagRequestBase & { history?: ChatTurn[] } = {}, signal?: AbortSignal) {
        const q = validQuery(question);
        const filter = validFilter(request.scope);
        const stream = await this.rag.streamAsk(q, this.vectors.name, {
            topK: validTopK(request.topK ?? 6, RAG_LIMITS.maxAskTopK), filter, scoreThreshold: validDistance(request.maxDistance),
            history: validHistory(request.history), signal,
        });
        return { question: q, scope: scopeOf(filter), passages: passages(stream.citations), answer: stream.answer };
    }

    async chat(message: string, request: RagRequestBase & { conversationId?: string } = {}): Promise<RagChatResponse> {
        const m = validQuery(message);
        const filter = validFilter(request.scope);
        if (request.conversationId !== undefined && !/^[A-Za-z0-9-]{8,64}$/.test(String(request.conversationId)))
            throw new BadRequestException('conversationId must be the id a previous chat reply returned');
        const reply = await this.chatbot.chat(this.vectors.name, {
            conversationId: request.conversationId, message: m, filter,
            topK: validTopK(request.topK ?? 6, RAG_LIMITS.maxAskTopK), scoreThreshold: validDistance(request.maxDistance),
        });
        return {
            conversationId: reply.conversationId,
            message: reply.message,
            question: reply.question,
            scope: scopeOf(filter),
            answer: reply.answer,
            model: reply.citations.length > 0 ? this.chatModel.modelName : null,
            passages: passages(reply.citations),
        };
    }
}

function validQuery(query: unknown): string {
    const q = typeof query === 'string' ? query.trim() : '';
    if (q.length < RAG_LIMITS.minQueryChars || q.length > RAG_LIMITS.maxQueryChars)
        throw new BadRequestException(`the question must have ${RAG_LIMITS.minQueryChars} to ${RAG_LIMITS.maxQueryChars} characters`);
    return q;
}

function validTopK(topK: unknown, max: number): number {
    const k = Number(topK);
    if (!Number.isInteger(k) || k < 1 || k > max)
        throw new BadRequestException(`topK must be an integer between 1 and ${max}`);
    return k;
}

function validDistance(distance: unknown): number | undefined {
    if (distance === undefined || distance === null) return undefined;
    const d = Number(distance);
    if (!Number.isFinite(d) || d <= 0) throw new BadRequestException('maxDistance must be a positive number');
    return d;
}

function validFilter(scope: BibliotecaScope | undefined): VectorFilter | undefined {
    const paths = scope?.opusPaths;
    if (paths !== undefined && (!Array.isArray(paths) || paths.some(it => typeof it !== 'string')))
        throw new BadRequestException('scope.opusPaths must be a list of author/opus paths');
    if ((paths?.length ?? 0) > RAG_LIMITS.maxOpusPaths)
        throw new BadRequestException(`at most ${RAG_LIMITS.maxOpusPaths} works per scope`);
    const filter = bibliotecaFilter(scope ?? {});
    // a scope naming works, none of them valid, must not silently widen to the whole library
    if ((paths?.length ?? 0) > 0 && !filter)
        throw new BadRequestException('scope.opusPaths must be author/opus paths, e.g. "creanga/amintiri"');
    return filter;
}

function validHistory(history: unknown): ChatTurn[] {
    if (history === undefined || history === null) return [];
    if (!Array.isArray(history) || history.length > RAG_LIMITS.maxHistoryTurns
        || history.some(turn => !turn || !['user', 'assistant'].includes(turn.role)
            || typeof turn.content !== 'string' || turn.content.length > RAG_LIMITS.maxTurnChars))
        throw new BadRequestException(`history must be at most ${RAG_LIMITS.maxHistoryTurns} {role: user|assistant, content} turns`);
    return history.map(turn => ({ role: turn.role, content: turn.content }));
}

function scopeOf(filter: VectorFilter | undefined): BibliotecaScope {
    const paths = filter ? Object.values(filter)[0] as string[] : undefined;
    return paths ? { opusPaths: paths } : {};
}

function passages(results: SearchResultItem<BibliotecaParagraph>[]): RagPassage[] {
    return results.map((result, idx) => ({
        n: idx + 1,
        url: result.item.url,
        opusPath: result.item.opusPath,
        ...(result.item.title ? { title: result.item.title } : {}),
        ...(result.item.language ? { language: result.item.language } : {}),
        text: result.item.text,
        score: result.score,
    }));
}
