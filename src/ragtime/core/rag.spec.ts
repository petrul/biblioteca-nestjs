/// <reference types="jest" />
import { MemoryConversationStore, LlmQueryRewriter, RagChatbot } from './chatbot';
import { ContextExpander, MemTextItem, RagSystem, SearchResult, SearchResultItem, Searcher, TextItem } from './model';
import { DefaultPromptBuilder, PromptedGenerator, RagtimeSystem } from './rag';
import { ParagraphSplitter } from './splitter';
import { ScriptedChatModel } from './test-doubles';

const passage = (n: number, text = `passage ${n}`) =>
  new MemTextItem('s', `https://lib.test/p${n}`, text, {}, { id: `p${n}`, title: `Work ${n}` });

class FixedSearcher implements Searcher {
  readonly queries: string[] = [];
  constructor(private readonly items: TextItem[]) {}
  async search(query: string): Promise<SearchResult> {
    this.queries.push(query);
    return { query, results: this.items.map((item, i) => ({ item, score: i / 10, scoreKind: 'distance' as const })) };
  }
}

describe('DefaultPromptBuilder', () => {
  it('numbers the passages with their title and url, keeps recent history, ends with the question', async () => {
    const messages = await new DefaultPromptBuilder({ maxHistoryTurns: 2 }).build('what?', [passage(1), passage(2)], [
      { role: 'user', content: 'old' }, { role: 'assistant', content: 'older answer' }, { role: 'user', content: 'recent' },
    ]);
    expect(messages[0].role).toBe('system');
    expect(messages.slice(1, 3).map((m) => m.content)).toEqual(['older answer', 'recent']);
    const last = messages.at(-1)!.content;
    expect(last).toContain('[1] Work 1 (https://lib.test/p1)\npassage 1');
    expect(last).toContain('[2] Work 2 (https://lib.test/p2)');
    expect(last.endsWith('Question: what?')).toBe(true);
  });

  it('shares the context budget between passages', async () => {
    const block = await new DefaultPromptBuilder({ maxContextChars: 400 }).passages([passage(1, 'x'.repeat(1000)), passage(2, 'y'.repeat(1000))]);
    expect(block.length).toBeLessThan(600);
    expect(block).toContain('...');
  });
});

describe('RagtimeSystem', () => {
  it('answers from the found passages and cites them', async () => {
    const model = new ScriptedChatModel(() => ' answer [1] ');
    const rag = new RagtimeSystem(new FixedSearcher([passage(1)]), new PromptedGenerator(model));
    const response = await rag.ask('question?', 'c');
    expect(response.answer).toBe('answer [1]');
    expect(response.citations.map((c) => c.item.id)).toEqual(['p1']);
    expect(model.calls[0].messages.at(-1)!.content).toContain('passage 1');
  });

  it('generates nothing when nothing was found', async () => {
    const model = new ScriptedChatModel();
    const rag = new RagtimeSystem(new FixedSearcher([]), new PromptedGenerator(model));
    expect(await rag.ask('question?', 'c')).toEqual({ question: 'question?', answer: '', citations: [] });
    const stream = await rag.streamAsk('question?', 'c');
    const chunks: string[] = [];
    for await (const chunk of stream.answer) chunks.push(chunk);
    expect(chunks).toEqual([]);
    expect(model.calls).toHaveLength(0);
  });

  it('searches for the retrieval query but answers the question', async () => {
    const model = new ScriptedChatModel();
    const searcher = new FixedSearcher([passage(1)]);
    await new RagtimeSystem(searcher, new PromptedGenerator(model)).ask('and then?', 'c', { retrievalQuery: 'what did Nica do after school' });
    expect(searcher.queries).toEqual(['what did Nica do after school']);
    expect(model.calls[0].messages.at(-1)!.content.endsWith('Question: and then?')).toBe(true);
  });

  it('generates from the expanded context, cites the hits, and refuses an expander that loses the numbering', async () => {
    const model = new ScriptedChatModel();
    const widen: ContextExpander = { expand: async (results) => results.map((r) => passage(9, `before. ${(r.item as MemTextItem).text}. after`)) };
    const response = await new RagtimeSystem(new FixedSearcher([passage(1)]), new PromptedGenerator(model), { expander: widen }).ask('q?', 'c');
    expect(model.calls[0].messages.at(-1)!.content).toContain('before. passage 1. after');
    expect(response.citations[0].item.id).toBe('p1');

    const lossy: ContextExpander = { expand: async () => [] };
    await expect(new RagtimeSystem(new FixedSearcher([passage(1)]), new PromptedGenerator(model), { expander: lossy }).ask('q?', 'c'))
      .rejects.toThrow('context expander');
  });

  it('streams the citations first, then the answer', async () => {
    const stream = await new RagtimeSystem(new FixedSearcher([passage(1)]), new PromptedGenerator(new ScriptedChatModel(() => 'one two three'))).streamAsk('q?', 'c');
    expect(stream.citations).toHaveLength(1);
    let answer = '';
    for await (const chunk of stream.answer) answer += chunk;
    expect(answer).toBe('one two three');
  });
});

describe('LlmQueryRewriter', () => {
  it('leaves a first message alone, rewrites follow-ups, falls back on failure', async () => {
    const model = new ScriptedChatModel(() => '"what did Nica steal"');
    const rewriter = new LlmQueryRewriter(model);
    expect(await rewriter.rewrite('who is Nica?', [])).toBe('who is Nica?');
    expect(model.calls).toHaveLength(0);
    const history = [{ role: 'user' as const, content: 'who is Nica?' }, { role: 'assistant' as const, content: 'a boy' }];
    expect(await rewriter.rewrite('and what did he steal?', history)).toBe('what did Nica steal');
    expect(model.calls[0].messages.at(-1)!.content).toContain('User: who is Nica?');
    expect(model.calls[0].messages.at(-1)!.content).not.toContain('a boy'); // answers left out by default
    await new LlmQueryRewriter(model, { includeAnswers: true }).rewrite('and then?', history);
    expect(model.calls[1].messages.at(-1)!.content).toContain('Assistant: a boy');

    const failing = new LlmQueryRewriter({ modelName: 'x', complete: async () => { throw new Error('down'); }, stream: async function* () { /* none */ } });
    expect(await failing.rewrite('and then?', [{ role: 'user', content: 'x' }])).toBe('and then?');
  });
});

describe('RagChatbot', () => {
  const fakeRag = (): RagSystem & { asked: unknown[] } => {
    const asked: unknown[] = [];
    return {
      asked,
      ask: async (question, _c, options) => {
        asked.push({ question, ...options });
        const citations: SearchResultItem[] = [{ item: passage(1), score: 0, scoreKind: 'distance' }];
        return { question, answer: `answer to ${question}`, citations };
      },
      streamAsk: async () => { throw new Error('unused'); },
    };
  };

  it('starts a conversation, then continues it with a rewritten follow-up and the history', async () => {
    const rag = fakeRag();
    const rewrites: string[] = [];
    const chatbot = new RagChatbot(rag, new MemoryConversationStore(), {
      rewriter: { rewrite: async (message, history) => { rewrites.push(message); return history.length ? `${message} (about Nica)` : message; } },
    });
    const first = await chatbot.chat('c', { message: 'who is Nica?', filter: { work: 'a/b' } });
    expect(first.conversationId).toMatch(/^[0-9a-f-]{36}$/);

    const second = await chatbot.chat('c', { conversationId: first.conversationId, message: 'and then?' });
    expect(second.question).toBe('and then? (about Nica)');
    expect(second.message).toBe('and then?');
    expect(rag.asked[1]).toMatchObject({
      question: 'and then?',
      retrievalQuery: 'and then? (about Nica)',
      history: [{ role: 'user', content: 'who is Nica?' }, { role: 'assistant', content: 'answer to who is Nica?' }],
    });
    expect(rag.asked[0]).toMatchObject({ filter: { work: 'a/b' } });
  });
});

describe('MemoryConversationStore', () => {
  it('keeps the latest turns and forgets the least recently used conversations', async () => {
    const store = new MemoryConversationStore({ maxConversations: 2, maxTurns: 2 });
    await store.append('a', [{ role: 'user', content: '1' }, { role: 'assistant', content: '2' }, { role: 'user', content: '3' }]);
    expect((await store.history('a')).map((t) => t.content)).toEqual(['2', '3']);
    await store.append('b', [{ role: 'user', content: 'b' }]);
    await store.append('a', [{ role: 'user', content: '4' }]);
    await store.append('c', [{ role: 'user', content: 'c' }]);
    expect(await store.history('b')).toEqual([]);
    expect(await store.history('a')).toHaveLength(2);
  });
});

describe('ParagraphSplitter', () => {
  it('keeps a short item as it is and packs a long one into overlapping passages', async () => {
    const splitter = new ParagraphSplitter({ maxChars: 100, overlapChars: 20 });
    const short = passage(1, 'short');
    expect(await splitter.split(short)).toEqual([short]);

    const long = passage(2, Array.from({ length: 8 }, (_, i) => `Sentence number ${i} is here.`).join('\n\n'));
    const parts = await splitter.split(long);
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts) expect((await part.getText()).length).toBeLessThanOrEqual(100);
    expect(parts.map((p) => p.url)).toEqual(parts.map((_, i) => `https://lib.test/p2#passage-${i + 1}`));
    expect(parts[1].metadata).toMatchObject({ parent_id: 'p2', passage: 2 });
    expect((await splitter.split(long)).map((p) => p.id)).toEqual(parts.map((p) => p.id)); // stable ids
  });

  it('cuts a single paragraph longer than the limit', async () => {
    const parts = await new ParagraphSplitter({ maxChars: 50, overlapChars: 0 }).split(passage(3, 'word '.repeat(40)));
    expect(parts.length).toBeGreaterThanOrEqual(4);
    for (const part of parts) expect((await part.getText()).length).toBeLessThanOrEqual(50);
  });
});
