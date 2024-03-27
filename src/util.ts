const { createHash } = require('crypto');

export const PROVIDER_LOGGER=Symbol('LoggerService')

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