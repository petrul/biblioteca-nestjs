import { Test } from '@nestjs/testing';
import { BibliotecaClient } from './biblioteca_client.service';
import { PROVIDER_LOGGER, Util } from '../util';
import { PROVIDER_CONF } from '../configuration';
import { TestUtils } from '../../test/testutils'
import { FakeBibliotecaClient } from '../../test/fake-biblioteca-client';
import { ConsoleLogger } from '@nestjs/common';

describe('Textbase_clientService', () => {
    // FakeBibliotecaClient stands in for the real one: no live textbase-server
    // is reachable from here right now (production is intermittently down,
    // and there's no other instance with real content) - see FakeBibliotecaClient's
    // own docstring.
    let tbc: BibliotecaClient;
    const conf = TestUtils.testConf;

    beforeEach(async () => {
        const module = await Test.createTestingModule({
            imports: [],
            controllers: [],
            providers: [
                {
                    provide: PROVIDER_LOGGER,
                    useClass: ConsoleLogger
                  },

                {
                    provide: PROVIDER_CONF,
                    useValue: conf
                },
                {
                    provide: BibliotecaClient,
                    useClass: FakeBibliotecaClient,
                },
            ],
        }).compile();

        tbc = module.get<BibliotecaClient>(BibliotecaClient);
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

    it('generator allopera', async () => {
        var counter = 0;
        for await (const o of tbc.allOperaGen()) {
            counter++;
        }
        expect(counter).toBeGreaterThan(1001);
        
    }, 
    TestUtils.TIMEOUT_TWO_MINUTES);
});
