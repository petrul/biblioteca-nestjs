import { Util } from './util';

describe('UtilSpec', () => {
    it('sha256', () => {
        const str = 'foaie verde';
        const bytes = Util.sha256(str)
        expect(bytes.constructor.name).toBe('Buffer')
        expect(bytes.length).toBe(32);

        const hex = Util.sha256AsHex(str);
        expect(Buffer.from(hex, "hex")).toEqual(bytes);
         
    });
});
