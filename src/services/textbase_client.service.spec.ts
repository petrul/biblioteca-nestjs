import { Test } from '@nestjs/testing';
import { TextbaseClient } from './textbase_client.service';
import { Util } from '../util';
import { AppConfService } from '../configuration';
import { TestUtils } from '../../test/testutils'

describe('Textbase_clientService', () => {
    let tbc: TextbaseClient;
    const conf = TestUtils.testConf;

    beforeEach(async () => {
        const module = await Test.createTestingModule({
            imports: [],
            controllers: [],
            providers: [
                {
                    provide: AppConfService,
                    useValue: conf
                },
                TextbaseClient
            ],  
        }).compile();

        tbc = module.get<TextbaseClient>(TextbaseClient);
    });

    it('generator paragraphs()',  async () => {
        expect(tbc).toBeDefined();
        
        const opera = await tbc.getAllOpera(0, 5);
    
        const op = opera[0]
        expect(op).not.toBeNull()
        expect(op.head).not.toBeNull()
        expect(op.id).toBeGreaterThan(0)
        expect(op.leaf).toBeFalsy()
    
        const gen = tbc.getParagraphs(op.id, 500)
        expect(gen).not.toBeNull()
        
        var i = 0
        for await (let elem of gen) {
            expect(elem).not.toBeNull()
            expect(elem.name).not.toBeNull()
            expect(elem.url).not.toBeNull()
            expect(elem.text).not.toBeNull()
            expect(elem.text_sha256).not.toBeNull()
            expect(elem.text_sha256).toEqual(Util.sha256AsHex(elem.text))
            i++;
        }
        expect(i).toBeGreaterThan(10);    
    }, 
        60 * 1000 // max 1 min timeout
    );
});
