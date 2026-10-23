import { randomUUID } from 'node:crypto';
import {
  ChatModel,
  ChatReply,
  ChatRequest,
  ChatTurn,
  Chatbot,
  ConversationStore,
  QueryRewriter,
  RagSystem,
  TextItem,
} from './model';

export interface MemoryConversationStoreOptions {
  /** Conversations kept; the least recently used go first. Default 1000. */
  maxConversations?: number;
  /** Turns kept per conversation (the latest). Default 40. */
  maxTurns?: number;
}

/** Conversations in RAM: lost on restart, bounded in size. */
export class MemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, ChatTurn[]>();

  constructor(private readonly options: MemoryConversationStoreOptions = {}) {}

  async history(conversationId: string): Promise<ChatTurn[]> {
    return [...(this.conversations.get(conversationId) ?? [])];
  }

  async append(conversationId: string, turns: ChatTurn[]): Promise<void> {
    const kept = [...(this.conversations.get(conversationId) ?? []), ...turns].slice(-(this.options.maxTurns ?? 40));
    this.conversations.delete(conversationId); // re-inserted last: most recently used
    this.conversations.set(conversationId, kept);
    while (this.conversations.size > (this.options.maxConversations ?? 1000)) {
      this.conversations.delete(this.conversations.keys().next().value as string);
    }
  }

  async clear(conversationId: string): Promise<void> {
    this.conversations.delete(conversationId);
  }
}

export const REWRITE_PROMPT = [
  'Rewrite the last user message so that it can be understood without the conversation, changing as little as possible:',
  'only replace pronouns and references ("he", "his ghost", "that book") with what they refer to in the conversation.',
  'Keep the question itself, its words and its language; add nothing else - no titles, authors or explanations.',
  'If the message is already understandable on its own, repeat it unchanged. Reply with the message only.',
].join(' ');

export interface LlmQueryRewriterOptions {
  /** Recent turns read at most. Default 6. */
  maxHistoryTurns?: number;
  /**
   * Read the answers too, not only what the user asked (default false): a
   * wrong answer would otherwise steer the next search wrong as well.
   */
  includeAnswers?: boolean;
}

/**
 * QueryRewriter over a ChatModel. Without history the message is already
 * standalone and no model is called; if the model fails, the message is
 * searched as it is.
 */
export class LlmQueryRewriter implements QueryRewriter {
  constructor(
    private readonly model: ChatModel,
    private readonly options: LlmQueryRewriterOptions = {},
  ) {}

  async rewrite(message: string, history: ChatTurn[], options: { signal?: AbortSignal } = {}): Promise<string> {
    const turns = this.options.includeAnswers ? history : history.filter((turn) => turn.role === 'user');
    if (turns.length === 0) return message;
    const conversation = turns.slice(-(this.options.maxHistoryTurns ?? 6))
      .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`).join('\n');
    try {
      const rewritten = (await this.model.complete([
        { role: 'system', content: REWRITE_PROMPT },
        { role: 'user', content: `Conversation:\n${conversation}\n\nLast user message: ${message}` },
      ], { signal: options.signal, deterministic: true })).trim().replace(/^["']|["']$/g, '');
      return rewritten || message;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return message;
    }
  }
}

export interface RagChatbotOptions {
  /** Rewrites follow-ups into standalone queries before retrieval. Without one, messages are searched as they are. */
  rewriter?: QueryRewriter;
  /** Answer recorded when nothing relevant was found. */
  notFoundAnswer?: string;
}

/**
 * A conversation over a RagSystem: each message is (rewritten from the
 * conversation, then) searched, answered with the conversation as context,
 * and recorded in the ConversationStore.
 */
export class RagChatbot<T extends TextItem = TextItem> implements Chatbot<T> {
  constructor(
    private readonly rag: RagSystem<T>,
    private readonly conversations: ConversationStore,
    private readonly options: RagChatbotOptions = {},
  ) {}

  async chat(collection: string, request: ChatRequest): Promise<ChatReply<T>> {
    const conversationId = request.conversationId ?? randomUUID();
    const history = await this.conversations.history(conversationId);
    const query = this.options.rewriter
      ? await this.options.rewriter.rewrite(request.message, history, { signal: request.signal })
      : request.message;
    const response = await this.rag.ask(request.message, collection, {
      retrievalQuery: query,
      history,
      topK: request.topK,
      filter: request.filter,
      scoreThreshold: request.scoreThreshold,
      signal: request.signal,
    });
    await this.conversations.append(conversationId, [
      { role: 'user', content: request.message },
      { role: 'assistant', content: response.answer || (this.options.notFoundAnswer ?? 'No relevant passage was found.') },
    ]);
    return { ...response, question: query, message: request.message, conversationId };
  }
}
