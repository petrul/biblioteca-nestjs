/// <reference types="jest" />
import { VectorizerService } from './vectorizer.service';
import { SharedTextbaseConfig } from '../configuration';
import { MemoryVectorStore, VectorCollectionManager } from '../ragtime/core';
import { BibliotecaVectorCollection } from '../biblioteca-rag/ragtime.providers';
import { bibliotecaCollectionSpec } from '../biblioteca-rag/biblioteca.source';

/**
 * The explicit, manual vector-dropping operations (POST
 * /api/vector-store/remove-opus and /reset) - by policy the only ones:
 * nothing in the automatic flow ever drops vectors.
 */
describe('VectorizerService.removeOpus (offline)', () => {
    const shared = {
        kafka: { newOpusImportedTopic: 't', opusReimportedTopic: 't', opusRemovedTopic: 't' },
        embedder: { model: 'TEST', dimension: 3 },
        paragraph: { minChars: 20, maxChars: 3000 },
    } as unknown as SharedTextbaseConfig;

    let store: MemoryVectorStore;
    let vectServ: VectorizerService;

    beforeEach(async () => {
        store = new MemoryVectorStore();
        await store.upsert('test', [
            { id: 'a', vector: [0], payload: { opus_path: 'seneca/de-vita' } },
            { id: 'b', vector: [0], payload: { opus_path: 'seneca/de-vita-longa' } },
        ]);
        vectServ = new VectorizerService(null as any, null as any, new BibliotecaVectorCollection(store, null as any, 'test', null as any), shared);
    });

    it("deletes exactly that work's vectors - never a similarly-prefixed sibling's", async () => {
        await vectServ.removeOpus('/seneca/de-vita/');
        expect(await store.count('test', { opus_path: 'seneca/de-vita' })).toBe(0);
        expect(await store.count('test', { opus_path: 'seneca/de-vita-longa' })).toBe(1);
    });

    it('refuses anything that is not an author/opus path, deleting nothing', async () => {
        for (const path of ['', 'seneca', '/', undefined as unknown as string])
            await expect(vectServ.removeOpus(path)).rejects.toThrow('not an author/opus path');
        expect(await store.count('test')).toBe(2);
    });
});

describe('BibliotecaVectorCollection.reset', () => {
    it('drops, then recreates the collection with its spec', async () => {
        const calls: string[] = [];
        const manager: VectorCollectionManager = {
            exists: async () => true,
            ensure: async (name, spec) => { calls.push(`ensure ${name} ${spec.dimension}`); },
            assertCompatible: async () => undefined,
            drop: async (name) => { calls.push(`drop ${name}`); },
        };
        await new BibliotecaVectorCollection(new MemoryVectorStore(), manager, 'paragraphs', bibliotecaCollectionSpec(1024)).reset();
        expect(calls).toEqual(['drop paragraphs', 'ensure paragraphs 1024']);
    });
});
