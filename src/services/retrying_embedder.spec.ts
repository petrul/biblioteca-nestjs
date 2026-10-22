/// <reference types="jest" />
import { ConsoleLogger } from '@nestjs/common';
import { Embedder } from '../ragtime/core';
import { RetryingEmbedder } from './retrying_embedder';

describe('RetryingEmbedder', () => {

    const texts = ['foaie verde'];
    const embedded = [[0.1, 0.2, 0.3]];
    const embedder = (embedBatch: jest.Mock): Embedder =>
        ({ embedBatch, embed: jest.fn(), modelName: 'm', dimension: 3, supportedLanguages: 'all', maxInputChars: 16384 });

    // fast for tests - production wiring in app.module.ts uses the 5000ms default
    const POLL_INTERVAL_MS = 5;

    it('returns the inner embedder result immediately when it succeeds first try', async () => {
        const inner = embedder(jest.fn().mockResolvedValue(embedded));
        const retrying = new RetryingEmbedder(inner, new ConsoleLogger(), POLL_INTERVAL_MS);

        const result = await retrying.embedBatch(texts);

        expect(result).toEqual(embedded);
        expect(inner.embedBatch).toHaveBeenCalledTimes(1);
        expect(await retrying.embed('foaie verde')).toEqual(embedded[0]);
        expect([retrying.modelName, retrying.dimension, retrying.maxInputChars]).toEqual(['m', 3, 16384]);
    });

    it('waits and retries on failure, then returns once the inner embedder recovers', async () => {
        const inner = embedder(jest.fn()
            .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
            .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
            .mockResolvedValueOnce(embedded));
        const retrying = new RetryingEmbedder(inner, new ConsoleLogger(), POLL_INTERVAL_MS);

        const result = await retrying.embedBatch(texts);

        expect(result).toEqual(embedded);
        expect(inner.embedBatch).toHaveBeenCalledTimes(3);
    });

    it('has no small hardcoded retry cap - keeps trying well past a handful of failures', async () => {
        // deliberately more failures than a "give up after N" cap (e.g. 3)
        // would tolerate, so this only passes if retries are genuinely
        // uncapped - but still resolves (unlike an actually-infinite mock),
        // so the test itself terminates instead of leaving an orphaned
        // never-settling retry loop running against a background timer.
        const failuresBeforeSuccess = 10;
        const mockFn = jest.fn();
        for (let i = 0; i < failuresBeforeSuccess; i++) {
            mockFn.mockRejectedValueOnce(new Error('down'));
        }
        mockFn.mockResolvedValueOnce(embedded);
        const inner = embedder(mockFn);
        const retrying = new RetryingEmbedder(inner, new ConsoleLogger(), POLL_INTERVAL_MS);

        const result = await retrying.embedBatch(texts);

        expect(result).toEqual(embedded);
        expect(inner.embedBatch).toHaveBeenCalledTimes(failuresBeforeSuccess + 1);
    });
});
