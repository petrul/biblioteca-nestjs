import { LoggerService } from '@nestjs/common';
import { retryUntilAvailable, StopWatch, Util } from './util';

describe('UtilSpec', () => {
    it('sha256', () => {
        const str = 'foaie verde';
        const bytes = Util.sha256(str)
        expect(bytes.constructor.name).toBe('Buffer')
        expect(bytes.length).toBe(32);

        const hex = Util.sha256AsHex(str);
        expect(Buffer.from(hex, "hex")).toEqual(bytes);

    });

    it('stopwatch', async () => {
        const watch = new StopWatch();
        expect(watch.toString().startsWith('00:00:')).toBeTruthy()
    })
});

/**
 * This is the mechanism behind both RetryingContentEmbedder (wraps
 * PROVIDER_EMBEDDER) and the MilvusCollection provider factory in
 * app.module.ts: if the embedder and/or Milvus are unreachable, neither
 * should flood the log with a raw exception (and its full stack trace) on
 * every failed attempt - each retry should log exactly one short line
 * saying the dependency is unavailable and that it's waiting, at the
 * configured poll interval (5s in production), until it recovers.
 */
describe('retryUntilAvailable', () => {

    // fast for tests - production call sites use the 5000ms default
    const POLL_INTERVAL_MS = 5;

    function mockLogger(): LoggerService {
        return {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            verbose: jest.fn(),
        };
    }

    it('returns the result immediately on first success, logging nothing', async () => {
        const logger = mockLogger();
        const fn = jest.fn().mockResolvedValue('ok');

        const result = await retryUntilAvailable(fn, logger, 'TestDep', POLL_INTERVAL_MS);

        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('logs one short warning per failed attempt instead of letting exceptions pile up unbounded', async () => {
        const logger = mockLogger();
        const failures = 4;
        const fn = jest.fn();
        for (let i = 0; i < failures; i++) {
            fn.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
        }
        fn.mockResolvedValueOnce('ok');

        const result = await retryUntilAvailable(fn, logger, 'Milvus', POLL_INTERVAL_MS);

        expect(result).toBe('ok');
        // exactly one warn call per failed attempt - not a raw exception/stack
        // trace dumped per attempt, and not just a single warning either
        // (which would mean it gave up instead of continuing to retry)
        expect(logger.warn).toHaveBeenCalledTimes(failures);
        (logger.warn as jest.Mock).mock.calls.forEach(([message]) => {
            expect(typeof message).toBe('string');
            expect(message).toContain('Milvus');
            expect(message).toContain('unavailable');
            expect(message).not.toContain('\n'); // one line, not a dumped stack trace
        });
    });

    it('waits at least pollIntervalMs between attempts instead of busy-looping', async () => {
        const logger = mockLogger();
        const fn = jest.fn()
            .mockRejectedValueOnce(new Error('down'))
            .mockRejectedValueOnce(new Error('down'))
            .mockResolvedValueOnce('ok');

        const start = Date.now();
        await retryUntilAvailable(fn, logger, 'TestDep', POLL_INTERVAL_MS);
        const elapsed = Date.now() - start;

        // 2 waits of POLL_INTERVAL_MS each (a little slack for scheduling jitter)
        expect(elapsed).toBeGreaterThanOrEqual(POLL_INTERVAL_MS * 2 - 2);
    });
});
