import { VectorizerService } from './vectorizer.service';
import { VectorStore, QdrantVectorStore } from './vector_store';
import { QdrantCollection } from './qdrant/qdrantcollection.service';
import { SharedTextbaseConfig } from '../configuration';
import { LoggerService } from '@nestjs/common';

/**
 * Offline port of both removeOpus tests of the live integration suites:
 * the whole removal path is delegation - VectorizerService.removeOpus ->
 * VectorStore.removeOpus -> QdrantCollection.deleteByOpusPath - with the
 * sibling-safety living in the opus_path derivation and the exact-match
 * filter (both covered offline in qdrantcollection.spec.ts, and against a
 * live filter engine by the collection-level integration smoke). Nothing
 * here needs a live Qdrant.
 *
 * All mocks, same pattern as vector_reuse.spec.ts and
 * vectorizer_language_filter.spec.ts.
 */

class FakeStore implements VectorStore {
    readonly removeOpus = jest.fn().mockResolvedValue(undefined);
    readonly flush = jest.fn().mockResolvedValue(undefined);
    readonly reset = jest.fn();
    async store(): Promise<any> { /* never reached here */ }
    async storeNewOrUpdated(): Promise<any> { /* never reached here */ }
    async alreadyStored(): Promise<any> { return []; }
    async repointUrls(): Promise<any> { /* never reached here */ }
    async compact(): Promise<any> { /* never reached here */ }
}

describe('VectorizerService.removeOpus (offline)', () => {

    const log: LoggerService = { log: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined, fatal: () => undefined, verbose: () => undefined };
    const shared = {
        kafka: { newOpusImportedTopic: 't', opusReimportedTopic: 't', opusRemovedTopic: 't' },
        embedder: { model: 'TEST', dimension: 3 },
        paragraph: { minChars: 20, maxChars: 3000 },
    } as unknown as SharedTextbaseConfig;

    let vecstore: FakeStore;
    let vectServ: VectorizerService;

    beforeEach(() => {
        vecstore = new FakeStore();
        vectServ = new VectorizerService(null as any, null as any, vecstore, log, shared);
    });

    it('delegates the removal to the store and flushes after it', async () => {
        await vectServ.removeOpus('seneca/de-vita');

        expect(vecstore.removeOpus).toHaveBeenCalledTimes(1);
        expect(vecstore.removeOpus).toHaveBeenCalledWith('seneca/de-vita');
        expect(vecstore.flush).toHaveBeenCalledTimes(1);
        // the flush must follow the removal, never precede it
        expect(vecstore.flush.mock.invocationCallOrder[0])
            .toBeGreaterThan(vecstore.removeOpus.mock.invocationCallOrder[0]);
    });
});

describe('QdrantVectorStore.removeOpus (offline)', () => {

    it('delegates to the collection as an exact opus_path delete', async () => {
        const deleteByOpusPath = jest.fn().mockResolvedValue(undefined);
        const col = { deleteByOpusPath } as unknown as QdrantCollection;
        const store = new QdrantVectorStore(col);

        await store.removeOpus('seneca/de-vita');

        expect(deleteByOpusPath).toHaveBeenCalledTimes(1);
        expect(deleteByOpusPath).toHaveBeenCalledWith('seneca/de-vita');
    });
});
