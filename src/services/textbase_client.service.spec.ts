/*
https://docs.nestjs.com/fundamentals/testing#unit-testing
*/

import { Test } from '@nestjs/testing';
import { TextbaseClient } from './textbase_client.service';
import exp from 'constants';

describe('Textbase_clientService', () => {
    let tbc: TextbaseClient;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [], // Add
            controllers: [], // Add
            providers: [TextbaseClient],   // Add
        }).compile();

        tbc = moduleRef.get<TextbaseClient>(TextbaseClient);
    });

    it('test a few methods', async () => {
        expect(tbc).toBeDefined();

        const authors = await tbc.getAuthors()
        expect(authors).not.toBeNull()
        expect(authors.length).toBeGreaterThan(0)
    
        const a = authors[0];
        console.log(a.strId);
        
        
        const opera = await tbc.getOpera(a.strId);
        
    
        const op = opera[0]
        console.log(op.head);
        
    
        const paras = await tbc.getParagraphs(op.id)
        console.log(paras);
        
        // return paras;
    });


});
