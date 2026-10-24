/// <reference types="jest" />
import { GenericIndexer, MemoryVectorStore } from '../ragtime/core';
import { OllamaEmbedder } from '../ragtime/adapters/ollama.embedder';
import { OllamaChatModel } from '../ragtime/adapters/ollama.chat-model';
import { DEFAULT_GENERATION_MODEL } from '../ragtime/adapters/ollama.model-finder';
import { FixtureLibraryReader } from '../../test/fixture-library-reader';
import { BibliotecaClient } from '../services/biblioteca_client.service';
import { BibliotecaDivSource, bibliotecaCollectionSpec, bibliotecaPayload } from './biblioteca.source';
import { BibliotecaVectorCollection } from './ragtime.providers';
import { RagChatResponse, RagService } from './rag.service';

/**
 * Chatting with a novel, live: Dickens' "A Christmas Carol" (743 paragraphs,
 * test/res/a_christmas_carol.json) indexed with the real bge-m3 into an
 * in-memory store, then one conversation through RagService - rewriting of
 * follow-ups, retrieval scoped to the book, neighbour context, answers from
 * the shared Ollama's generating model (whichever is loaded, else
 * qwen3.5:9b).
 *
 * Generation is not deterministic and the loaded model may vary - and the
 * model takes part in retrieval too (rewriting follow-ups, drafting a
 * hypothetical answer, reranking) - so the assertions are tolerant: every
 * turn answers, scoped to the book, with valid citations; most turns
 * retrieve the paragraph that holds the answer; most answers carry the fact.
 */
describe('chatting with a novel (live bge-m3 and Ollama)', () => {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://zmeu.local:11434';
  const reader = new FixtureLibraryReader('a_christmas_carol');
  const scope = { opusPaths: [reader.opusPath] };
  let rag: RagService;

  const turns: { message: string; expected: RegExp; inPassages: RegExp; followUpOf?: RegExp }[] = [
    { message: 'Who was Jacob Marley?', expected: /partner|dead|ghost/i, inPassages: /Marley/ },
    { message: 'What did his ghost carry or wear when it came to Scrooge?', expected: /chain/i, inPassages: /chain/i, followUpOf: /Marley/i },
    { message: 'How many spirits did the ghost announce to Scrooge?', expected: /three|\b3\b/i, inPassages: /three spirits|Expect the first/i },
    { message: 'Who is Bob Cratchit?', expected: /clerk/i, inPassages: /clerk/i },
    { message: 'What is the name of his youngest son, the lame one?', expected: /Tiny Tim/i, inPassages: /Tiny Tim/, followUpOf: /Cratchit|Bob/i },
    { message: "Whose Christmas ball does the first spirit show Scrooge from his apprenticeship?", expected: /Fezziwig/i, inPassages: /Fezziwig/ },
    { message: 'What does Scrooge send to the Cratchits on Christmas morning?', expected: /turkey/i, inPassages: /turkey/i },
    { message: 'Despre ce este vorba în acest roman?', expected: /Scrooge|Christmas|Cratchit|Marley/i, inPassages: /Scrooge|Christmas|Marley/i },
    { message: 'Cine sunt personajele principale?', expected: /Scrooge|Marley|Cratchit|Tiny Tim/i, inPassages: /Scrooge|Marley|Cratchit/i },
  ];

  beforeAll(async () => {
    const embedder = new OllamaEmbedder({ url: ollamaUrl, model: 'bge-m3', dimension: 1024, keepAlive: -1, maxInputChars: 3000, maxBatchSize: 64 });
    const store = new MemoryVectorStore();
    const vectors = new BibliotecaVectorCollection(store, null as any, 'novel', bibliotecaCollectionSpec(1024));
    const stats = await new GenericIndexer(embedder, store).indexSource(new BibliotecaDivSource(reader, reader.opusId), vectors.name, {
      batchSize: 200,
      prepareText: (text) => (text.length > 20 ? text : null), // the vectorizer's paragraph floor
      payloadOf: bibliotecaPayload,
    });
    expect(stats.generatedVectors).toBeGreaterThan(600);
    rag = new RagService(reader as unknown as BibliotecaClient, embedder, vectors,
      new OllamaChatModel({ url: ollamaUrl, defaultModel: DEFAULT_GENERATION_MODEL }));
  }, 10 * 60_000);

  it('answers who and what questions, and follow-ups, from the book', async () => {
    const replies: RagChatResponse[] = [];
    let conversationId: string | undefined;
    for (const turn of turns) {
      const reply = await rag.chat(turn.message, { conversationId, scope, topK: 6 });
      conversationId = reply.conversationId;
      replies.push(reply);
    }

    // the conversation, for whoever reads the CI log
    console.log(replies.map((reply, idx) => [
      `Q${idx + 1}: ${reply.message}` + (reply.question !== reply.message ? `\n    (searched: ${reply.question})` : ''),
      `A${idx + 1} [${reply.model}]: ${reply.answer}`,
      ...reply.passages.slice(0, 3).map((p) => `    [${p.n}] ${p.scoreKind} ${p.score.toFixed(3)} ${p.title}: ${p.text.slice(0, 100).replace(/\s+/g, ' ')}`),
    ].join('\n')).join('\n\n'));

    replies.forEach((reply) => {
      expect(reply.conversationId).toBe(conversationId);
      expect(reply.answer.trim().length).toBeGreaterThan(10);
      expect(reply.passages.length).toBeGreaterThan(0);
      reply.passages.forEach((p) => expect(p.opusPath).toBe(reader.opusPath));
      // citations, when given, point at passages that exist
      for (const [, n] of reply.answer.matchAll(/\[(\d+)\]/g)) expect(Number(n)).toBeLessThanOrEqual(reply.passages.length);
    });

    // most turns find the paragraph that holds the answer among their hits
    // (the model also reads each hit's neighbours, which can hold it instead)
    const found = replies.filter((reply, idx) => reply.passages.some((p) => turns[idx].inPassages.test(p.text))).length;
    expect(found).toBeGreaterThanOrEqual(turns.length - 2);

    // generation is not: most answers carry the expected fact
    const right = replies.filter((reply, idx) => turns[idx].expected.test(reply.answer)).length;
    expect(right).toBeGreaterThanOrEqual(turns.length - 2);

    // follow-ups are searched for with the person they are about
    const followUps = turns.map((turn, idx) => ({ turn, reply: replies[idx] })).filter(({ turn }) => turn.followUpOf);
    expect(followUps.filter(({ turn, reply }) => turn.followUpOf!.test(reply.question)).length).toBeGreaterThanOrEqual(1);
  }, 10 * 60_000);
});
