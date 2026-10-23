/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common';
import { GenericIndexer, MemoryVectorStore } from '../ragtime/core';
import { KeywordEmbedder, ScriptedChatModel } from '../ragtime/core/test-doubles';
import { FakeParagraphReader } from '../../test/fake-paragraph-reader';
import { BibliotecaClient } from '../services/biblioteca_client.service';
import { BibliotecaDivSource, bibliotecaCollectionSpec, bibliotecaPayload } from './biblioteca.source';
import { BibliotecaVectorCollection } from './ragtime.providers';
import { BIBLIOTECA_SYSTEM_PROMPT, RagService } from './rag.service';

/** The model calls that answered (HyDE drafts and reranking call the model too). */
const answering = (model: ScriptedChatModel) => model.calls.filter((call) => call.messages[0].content === BIBLIOTECA_SYSTEM_PROMPT);

/**
 * RagService end to end over a fake library: the real ragtime searcher, RAG
 * system and chatbot, the real Biblioteca resolver and expander, with an
 * in-memory store, a keyword embedder and a scripted chat model.
 */
const PAD = ' — o frază mai lungă, ca un paragraf adevărat de carte, cu destule cuvinte.';

describe('RagService', () => {
  async function setup(script?: ConstructorParameters<typeof ScriptedChatModel>[0]) {
    const reader = new FakeParagraphReader()
      .div('creanga/amintiri', 'Amintiri din copilărie', 'Ion Creangă', [
        'Nică merge la școală la Humulești. — o frază mai lungă, ca un paragraf adevărat de carte, cu destule cuvinte.', 'Nică fura cireșe din grădina mătușii. — o frază mai lungă, ca un paragraf adevărat de carte, cu destule cuvinte.', 'Mătușa îl prinde în cireș. — o frază mai lungă, ca un paragraf adevărat de carte, cu destule cuvinte.', 'Hm!'])
      .div('eminescu/luceafarul', 'Luceafărul', 'Mihai Eminescu', ['A fost odată ca-n povești o fată. — o frază mai lungă, ca un paragraf adevărat de carte, cu destule cuvinte.', 'Luceafărul coboară din cer. — o frază mai lungă, ca un paragraf adevărat de carte, cu destule cuvinte.']);
    const embedder = new KeywordEmbedder(256);
    const store = new MemoryVectorStore();
    const vectors = new BibliotecaVectorCollection(store, { exists: async () => true, ensure: async () => undefined, assertCompatible: async () => undefined, drop: async () => undefined },
      'paragraphs', bibliotecaCollectionSpec(256));
    for (const divId of [1, 2]) {
      await new GenericIndexer(embedder, store).indexSource(new BibliotecaDivSource(reader, divId), vectors.name, { payloadOf: bibliotecaPayload });
    }
    const model = new ScriptedChatModel(script);
    return { rag: new RagService(reader as unknown as BibliotecaClient, embedder, vectors, model), model };
  }

  it('searches the whole library, or only the works of the scope', async () => {
    const { rag } = await setup();
    const all = await rag.search('Nică cireșe', { topK: 5 });
    expect(all.passages[0]).toMatchObject({ n: 1, opusPath: 'creanga/amintiri', title: 'Ion Creangă, Amintiri din copilărie' });
    expect(all.passages[0].text.startsWith('Nică fura cireșe')).toBe(true);
    expect(new Set(all.passages.map((p) => p.opusPath))).toEqual(new Set(['creanga/amintiri', 'eminescu/luceafarul']));
    expect(all.passages.map((p) => p.text)).not.toContain('Hm!'); // too short to say anything

    const book = await rag.search('Nică cireșe', { topK: 5, scope: { opusPaths: ['/eminescu/luceafarul/'] } });
    expect(book.scope).toEqual({ opusPaths: ['eminescu/luceafarul'] });
    expect(book.passages.every((p) => p.opusPath === 'eminescu/luceafarul')).toBe(true);
  });

  it('answers a book question from its passages, read with their neighbours, citing them', async () => {
    const { rag, model } = await setup(() => 'Nică fura cireșe [1].');
    const answer = await rag.ask('Ce fura Nică?', { scope: { opusPaths: ['creanga/amintiri'] }, topK: 1 });
    expect(answer).toMatchObject({ answer: 'Nică fura cireșe [1].', model: 'scripted' });
    expect(answer.passages).toHaveLength(1);
    const prompt = answering(model)[0].messages.at(-1)!.content;
    expect(prompt).toContain('[1] Ion Creangă, Amintiri din copilărie');
    expect(prompt).toContain(`Nică merge la școală la Humulești.${PAD}\n\nNică fura cireșe din grădina mătușii.${PAD}\n\nMătușa îl prinde în cireș.${PAD}`);
    expect(answering(model)).toHaveLength(1);
  });

  it('generates nothing when the scope has no close enough passage (and none sharing a word)', async () => {
    const { rag, model } = await setup();
    const answer = await rag.ask('quantum chromodynamics', { scope: { opusPaths: ['creanga/amintiri'] }, maxDistance: 0.0001 });
    expect(answer).toMatchObject({ answer: '', model: null, passages: [] });
    expect(answering(model)).toHaveLength(0);
  });

  it('chats: a follow-up is rewritten from the conversation before searching', async () => {
    const { rag, model } = await setup((messages) =>
      messages[0].content.startsWith('Rewrite') ? 'ce face mătușa când îl prinde pe Nică în cireș' : 'answer [1]');
    const first = await rag.chat('Cine fura cireșe?', { scope: { opusPaths: ['creanga/amintiri'] } });
    const second = await rag.chat('Și ea ce face?', { conversationId: first.conversationId, scope: { opusPaths: ['creanga/amintiri'] } });
    expect(second).toMatchObject({ conversationId: first.conversationId, message: 'Și ea ce face?', question: 'ce face mătușa când îl prinde pe Nică în cireș' });
    const answered = answering(model).at(-1)!.messages;
    expect(answered.map((m) => m.content)).toEqual(expect.arrayContaining(['Cine fura cireșe?', 'answer [1]']));
  });

  it('streams the passages, then the answer', async () => {
    const { rag } = await setup(() => 'one two');
    const stream = await rag.streamAsk('Nică cireșe', { topK: 2 });
    expect(stream.passages).toHaveLength(2);
    let answer = '';
    for await (const chunk of stream.answer) answer += chunk;
    expect(answer).toBe('one two');
  });

  it.each([
    ['a too short question', () => ['ab', {}]],
    ['topK out of range', () => ['Nică', { topK: 99 }]],
    ['a scope of invalid works only', () => ['Nică', { scope: { opusPaths: ['creanga'] } }]],
    ['a scope that is not a list', () => ['Nică', { scope: { opusPaths: 'creanga/amintiri' } }]],
    ['a bad maxDistance', () => ['Nică', { maxDistance: -1 }]],
    ['malformed history', () => ['Nică', { history: [{ role: 'system', content: 'x' }] }]],
  ])('rejects %s', async (_name, args) => {
    const { rag } = await setup();
    const [question, request] = args() as [string, any];
    await expect(rag.ask(question, request)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a conversation id it could not have issued', async () => {
    const { rag } = await setup();
    await expect(rag.chat('Nică', { conversationId: 'x; drop' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
