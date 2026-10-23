import { ChatModel, QueryExpander, Reranker, SearchResultItem, TextItem } from './model';

export const HYPOTHETICAL_ANSWER_PROMPT = [
  'Write one short paragraph, as it could appear in the text the question is about, that would answer the question.',
  'Use the names, places and words that text would use, in the language of the question. Reply with the paragraph only.',
].join(' ');

/**
 * HyDE: the model drafts a passage that would answer the query; searching
 * with it finds the passage that actually does far better than the bare
 * question (a plot question shares few words or little meaning with its
 * answer). The draft may be wrong - it only steers retrieval; answers come
 * from what is found. Failures expand to nothing.
 */
export class HypotheticalAnswerExpander implements QueryExpander {
  constructor(
    private readonly model: ChatModel,
    private readonly prompt = HYPOTHETICAL_ANSWER_PROMPT,
  ) {}

  async expand(query: string, options: { signal?: AbortSignal } = {}): Promise<string[]> {
    try {
      const draft = (await this.model.complete([
        { role: 'system', content: this.prompt },
        { role: 'user', content: query },
      ], { signal: options.signal, deterministic: true })).trim();
      return draft ? [draft] : [];
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return [];
    }
  }
}

export const RERANK_PROMPT = [
  'You are given a question and numbered passages.',
  'Reply with JSON {"passages": [numbers]}: the passages that help answer the question, most useful first.',
].join(' ');

export interface LlmRerankerOptions {
  /** Characters of each passage shown to the model. Default 250. */
  excerptChars?: number;
  prompt?: string;
}

/**
 * Listwise reranking by a ChatModel: shown the question and numbered
 * excerpts, it names the useful ones, best first. Unparseable or failed
 * replies keep the original order.
 */
export class LlmReranker implements Reranker {
  constructor(
    private readonly model: ChatModel,
    private readonly options: LlmRerankerOptions = {},
  ) {}

  async rerank<T extends TextItem>(query: string, results: SearchResultItem<T>[], topK: number): Promise<SearchResultItem<T>[]> {
    if (results.length <= 1) return results.slice(0, topK);
    const excerpt = this.options.excerptChars ?? 250;
    const listing = (await Promise.all(results.map(async (r, idx) =>
      `[${idx + 1}] ${(await r.item.getText()).replace(/\s+/g, ' ').slice(0, excerpt)}`))).join('\n');
    try {
      const reply = await this.model.complete([
        { role: 'system', content: `${this.options.prompt ?? RERANK_PROMPT} At most ${topK}.` },
        { role: 'user', content: `Question: ${query}\n\nPassages:\n${listing}` },
      ], { json: true, deterministic: true });
      const picked = (JSON.parse(reply)?.passages ?? []) as unknown[];
      const chosen = [...new Set(picked.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= results.length))];
      return chosen.slice(0, topK).map((n) => results[n - 1]);
    } catch {
      return results.slice(0, topK);
    }
  }
}
