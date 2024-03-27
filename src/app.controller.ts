import { Controller, Param, Post, Query } from '@nestjs/common';
import { TextbaseClient } from './services/textbase_client.service';
import { VectorizerService } from './services/vectorizer.service';
import { StopWatch, Util } from './util';
import { EntityModelTeiDiv } from './textbase.api';
import { log } from 'console';
import { MilvusCollection } from './services/milvus/milvuscollection.service';

// type lang = EntityModelTeiDiv.lang;

function enRoInFata(o1: EntityModelTeiDiv, o2: EntityModelTeiDiv) : number {
  if (o1.lang == o2.lang) return 0;
  if (o1.lang == 'EN') return -3; else
  if (o1.lang == 'RO') return -2; else
  if (o1.lang == 'FR') return -1;
  else 
    return -o1.lang.localeCompare(o2.lang);

}

@Controller()
export class AppController {
  
  constructor(protected tbc: TextbaseClient, protected vectorizer: VectorizerService, protected col: MilvusCollection) {}

  @Post('/revectorize_all')
  async revectorizeAll(@Query('shuffle') shuffle: boolean = false): Promise<any> {

    const opera = await this.tbc.getAllOpera(0, 20000);
    console.log(opera.length);
    if (shuffle) {
      Util.shuffleArray(opera);
    }
    console.log(opera.length);

    for (const op of opera) {
      try {
        const watch = new StopWatch();
        console.log
        console.log(`will vectorize: `, op);
        const opid = op.id;
  
        console.log(`starting vectorizing for ${opid}`);
        await this.vectorizer.vectorize(opid);
        console.log(`done vectorizing for ${opid}. took ${watch}`);  
      } catch (err: any) {
        console.error('will ignore', err);
        
      }
    }

  }

  @Post('/optimize')
  async optimize() {
    return await this.col.compact();
  }
}
