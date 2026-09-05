import { ConsoleLogger } from '@nestjs/common';
import { Content, ContentEmbedder } from '../model/model';
import { RetryingContentEmbedder } from './retrying_content_embedder';

describe('RetryingContentEmbedder', () => {

    const content: Content[] = [{ text: 'foaie verde', url: 'u1', sha256: 's1' }];
    const embedded: Content[] = [{ ...content[0], embedding: [0.1, 0.2, 0.3] }];

    // fast for tests - production wiring in app.module.ts uses the 5000ms default
    const POLL_INTERVAL_MS = 5;

    it('returns the inner embedder result immediately when it succeeds first try', async () => {
        const inner: ContentEmbedder = { embeddings: jest.fn().mockResolvedValue(embedded), supportedLanguages: 'all' };
        const retrying = new RetryingContentEmbedder(inner, new ConsoleLogger(), POLL_INTERVAL_MS);

        const result = await retrying.embeddings(content);

        expect(result).toEqual(embedded);
        expect(inner.embeddings).toHaveBeenCalledTimes(1);
    });

    it('waits and retries on failure, then returns once the inner embedder recovers', async () => {
        const inner: ContentEmbedder = {
            embeddings: jest.fn()
                .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
                .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
                .mockResolvedValueOnce(embedded),
            supportedLanguages: 'all',
        };
        const retrying = new RetryingContentEmbedder(inner, new ConsoleLogger(), POLL_INTERVAL_MS);

        const result = await retrying.embeddings(content);

        expect(result).toEqual(embedded);
        expect(inner.embeddings).toHaveBeenCalledTimes(3);
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
        const inner: ContentEmbedder = { embeddings: mockFn, supportedLanguages: 'all' };
        const retrying = new RetryingContentEmbedder(inner, new ConsoleLogger(), POLL_INTERVAL_MS);

        const result = await retrying.embeddings(content);

        expect(result).toEqual(embedded);
        expect(inner.embeddings).toHaveBeenCalledTimes(failuresBeforeSuccess + 1);
    });
});
