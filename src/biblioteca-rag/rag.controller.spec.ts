/// <reference types="jest" />
import { Test } from '@nestjs/testing';
import { MemoryVectorStore } from '../ragtime/core';
import { KeywordEmbedder, ScriptedChatModel } from '../ragtime/core/test-doubles';
import { BibliotecaClient } from '../services/biblioteca_client.service';
import { bibliotecaCollectionSpec } from './biblioteca.source';
import { RagController } from './rag.controller';
import { BIBLIOTECA_SYSTEM_PROMPT, RagService } from './rag.service';
import { BibliotecaVectorCollection, PROVIDER_CHAT_MODEL, PROVIDER_EMBEDDER, PROVIDER_VECTOR_COLLECTION } from './ragtime.providers';
import { ChatController } from '../chat.controller';

/** RagController and RagService resolve through Nest's container with the providers app.module gives them. */
describe('RagController wiring', () => {
  it('injects the service and answers an empty library without generating', async () => {
    const model = new ScriptedChatModel();
    const moduleRef = await Test.createTestingModule({
      controllers: [RagController],
      providers: [
        RagService,
        { provide: BibliotecaClient, useValue: {} },
        { provide: PROVIDER_EMBEDDER, useValue: new KeywordEmbedder() },
        { provide: PROVIDER_CHAT_MODEL, useValue: model },
        { provide: PROVIDER_VECTOR_COLLECTION, useValue: new BibliotecaVectorCollection(new MemoryVectorStore(), null as any, 'c', bibliotecaCollectionSpec(64)) },
      ],
    }).compile();
    const controller = moduleRef.get(RagController);
    expect(await controller.ask({ question: 'Ce fura Nică?' })).toMatchObject({ answer: '', model: null, passages: [] });
    expect(model.calls.filter((call) => call.messages[0].content === BIBLIOTECA_SYSTEM_PROMPT)).toHaveLength(0);
  });

  it('keeps the old rag chat route on the legacy implementation', async () => {
    const legacyChat = jest.fn().mockResolvedValue({ answer: 'legacy' });
    const controller = new RagController({ legacyChat } as unknown as RagService);

    await controller.chat({ message: 'old question' });

    expect(legacyChat).toHaveBeenCalledWith('old question', {
      scope: undefined, topK: undefined, maxDistance: undefined, conversationId: undefined,
    });
  });

  it('routes the new mcp chat surface through the MCP-enabled service method', async () => {
    const chat = jest.fn().mockResolvedValue({ answer: 'grounded' });
    const controller = new ChatController({ chat } as unknown as RagService);

    await controller.chat({ message: 'new question' });

    expect(chat).toHaveBeenCalledWith('new question', {
      scope: undefined, topK: undefined, maxDistance: undefined, conversationId: undefined,
    });
  });
});
