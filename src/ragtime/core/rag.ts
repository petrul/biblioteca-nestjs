import {
  AskOptions,
  ChatMessage,
  ChatModel,
  ChatTurn,
  ContextExpander,
  GenerateOptions,
  Generator,
  PromptBuilder,
  RagResponse,
  RagStream,
  RagSystem,
  Searcher,
  TextItem,
} from './model';

export const DEFAULT_SYSTEM_PROMPT = [
  'You answer questions from the numbered passages you are given, and from nothing else.',
  'Cite the passages you rely on as [1], [2]... right after the statement they support.',
  'If the passages do not contain the answer, say so plainly instead of guessing.',
  'Answer in the language of the question.',
].join(' ');

export interface DefaultPromptBuilderOptions {
  systemPrompt?: string;
  /** Characters of passages sent at most, shared equally between them. Default 12000. */
  maxContextChars?: number;
  /** Earlier turns kept at most (the most recent ones). Default 10. */
  maxHistoryTurns?: number;
}

/**
 * System prompt, the recent conversation, then the numbered passages and the
 * question: `[n] title (url)` before each passage, which the answer cites.
 */
export class DefaultPromptBuilder implements PromptBuilder {
  constructor(private readonly options: DefaultPromptBuilderOptions = {}) {}

  async build(question: string, context: TextItem[], history: ChatTurn[] = []): Promise<ChatMessage[]> {
    const passages = await this.passages(context);
    const recent = history.slice(-(this.options.maxHistoryTurns ?? 10));
    return [
      { role: 'system', content: this.options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
      ...recent.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: 'user', content: passages ? `Passages:\n\n${passages}\n\nQuestion: ${question}` : question },
    ];
  }

  async passages(context: TextItem[]): Promise<string> {
    if (context.length === 0) return '';
    const share = Math.max(200, Math.floor((this.options.maxContextChars ?? 12_000) / context.length));
    const blocks = await Promise.all(context.map(async (item, idx) => {
      const text = (await item.getText()).trim();
      const heading = [`[${idx + 1}]`, item.title, `(${item.url})`].filter(Boolean).join(' ');
      return `${heading}\n${text.length > share ? `${text.slice(0, share)}...` : text}`;
    }));
    return blocks.join('\n\n');
  }
}

/** A Generator from any ChatModel and a PromptBuilder. */
export class PromptedGenerator implements Generator {
  constructor(
    private readonly model: ChatModel,
    private readonly prompts: PromptBuilder = new DefaultPromptBuilder(),
  ) {}

  get modelName(): string {
    return this.model.modelName;
  }

  async generate(prompt: string, context: TextItem[], options: GenerateOptions = {}): Promise<string> {
    const messages = await this.prompts.build(prompt, context, options.history);
    return (await this.model.complete(messages, { signal: options.signal })).trim();
  }

  async *streamGenerate(prompt: string, context: TextItem[], options: GenerateOptions = {}): AsyncIterable<string> {
    const messages = await this.prompts.build(prompt, context, options.history);
    yield* this.model.stream(messages, { signal: options.signal });
  }
}

export interface RagtimeSystemOptions<T extends TextItem> {
  /** Widens the hits (e.g. with neighbouring passages) before generation. */
  expander?: ContextExpander<T>;
}

async function* nothing(): AsyncIterable<string> {
  // no passage, no generation
}

/** Retrieval-augmented generation: search, then answer from what was found. */
export class RagtimeSystem<T extends TextItem = TextItem> implements RagSystem<T> {
  constructor(
    private readonly searcher: Searcher<T>,
    private readonly generator: Generator,
    private readonly options: RagtimeSystemOptions<T> = {},
  ) {}

  private async retrieve(question: string, collection: string, options: AskOptions) {
    const { results } = await this.searcher.search(options.retrievalQuery ?? question, collection, {
      topK: options.topK ?? 4,
      filter: options.filter,
      scoreThreshold: options.scoreThreshold,
      signal: options.signal,
    });
    let context: TextItem[] = results.map((r) => r.item);
    if (results.length > 0 && this.options.expander) {
      const expanded = await this.options.expander.expand(results);
      if (expanded.length !== results.length) {
        throw new Error(`context expander returned ${expanded.length} items for ${results.length} results`);
      }
      context = expanded;
    }
    return { results, context };
  }

  async ask(question: string, collection: string, options: AskOptions = {}): Promise<RagResponse<T>> {
    const { results, context } = await this.retrieve(question, collection, options);
    if (results.length === 0) return { question, answer: '', citations: [] };
    const answer = await this.generator.generate(question, context, { history: options.history, signal: options.signal });
    return { question, answer, citations: results };
  }

  async streamAsk(question: string, collection: string, options: AskOptions = {}): Promise<RagStream<T>> {
    const { results, context } = await this.retrieve(question, collection, options);
    return {
      question,
      citations: results,
      answer: results.length === 0
        ? nothing()
        : this.generator.streamGenerate(question, context, { history: options.history, signal: options.signal }),
    };
  }
}
