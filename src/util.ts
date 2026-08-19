import { LoggerService } from '@nestjs/common';

const { createHash } = require('crypto');

export const PROVIDER_LOGGER=Symbol('LoggerService')

/**
 * Runs fn(), and if it throws, waits pollIntervalMs and tries again -
 * indefinitely, no cap - instead of the caller failing outright the moment
 * a dependency (the embedder, Milvus, whichever) happens to be unreachable.
 * Used both for the embedder (see RetryingContentEmbedder) and for the
 * Milvus collection at startup (see app.module.ts's MilvusCollection
 * provider) - both should just sit and wait for their dependency to come
 * back, however long that takes, rather than crashing the app or failing
 * one page/message at a time for nothing while it's down.
 */
export async function retryUntilAvailable<T>(
    fn: () => Promise<T>,
    logger: LoggerService,
    label: string,
    pollIntervalMs = 5000,
): Promise<T> {
    while (true) {
        try {
            return await fn();
        } catch (e) {
            logger.warn(
                `${label} unavailable (${e?.message ?? e}) - waiting ${pollIntervalMs}ms and retrying...`,
                label,
            );
            await Util.delay(pollIntervalMs);
        }
    }
}

export class Util {



    static sha256(str: string ) : Buffer {
        return createHash('sha256').update(str).digest();
    }

    static sha256AsHex(str: string ) : string {
        return createHash('sha256').update(str).digest('hex');
    }

    static hex2bytes(str: string) : Buffer {
        return Buffer.from(str, "hex")
    }


    /* Randomize array in-place using Durstenfeld shuffle algorithm */
    static shuffleArray(array) : void {
        for (var i = array.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = array[i];
            array[i] = array[j];
            array[j] = temp;
        }
    }

    static delay(milliseconds: number) {
        return new Promise(resolve => {
            setTimeout(resolve, milliseconds);
        });
    }
}

export class StopWatch {

    private start: number;

    constructor() {
        this.start = Date.now();
    }

    toString() : string {
        const end = Date.now();
        return this.formatTime(end - this.start);
    }

    private formatTime(ms) {
        const minutes = Math.floor(ms / (1000 * 60));
        const seconds = Math.floor((ms % (1000 * 60)) / 1000);
        const milliseconds = Math.floor(ms % 1000);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${milliseconds.toString().padStart(3, '0')}`;
    }
    
}