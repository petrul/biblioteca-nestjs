const { createHash } = require('crypto');

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

}