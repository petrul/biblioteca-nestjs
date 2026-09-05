import { Controller, Get, Logger, Post, Query } from '@nestjs/common';
import { TextbaseClient } from './services/textbase_client.service';
import { VectorizerService } from './services/vectorizer.service';
import { StopWatch, Util } from './util';
import { EntityModelTeiDiv } from './textbase.api';
import { MilvusCollection } from './services/milvus/milvuscollection.service';

const packageInfo: { name: string; version: string } = require('../package.json');

export interface AppInfo {
  name: string;
  version: string;
}


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
  
  constructor(protected tbc: TextbaseClient, 
    protected vectorizer: VectorizerService, 
    protected col: MilvusCollection) {}

  @Get('/api/info')
  info(): AppInfo {
    return {
      name: packageInfo.name,
      version: packageInfo.version,
    };
  }

  @Post('/revectorize_all')
  async revectorizeAll(@Query('shuffle') shuffle: boolean = false): Promise<any> {

    const opera: EntityModelTeiDiv[] = [];
    for await(const i of this.tbc.allOperaGen()) {
      if (i)
        opera.push(i); 
    }

    if (shuffle) {
      Util.shuffleArray(opera);
    }
    this.log.log(`opera length: ${opera.length}`);

    for (const op of opera) {
      try {
        const watch = new StopWatch();
        this.log.log(`will vectorize: `, op);
        const opid = op.id;
  
        this.log.log(`starting vectorizing for ${opid} - ${op.completePath} - ${op.author?.visualName} - '${op.head}'`);
        await this.vectorizer.vectorize(opid);
        this.log.log(`done vectorizing for ${opid}. took ${watch}`);  
      } catch (err: any) {
        this.log.error('will ignore', err);        
      }
    }

  }

  @Post('/optimize')
  async optimize() {
    return await this.col.compact();
  }

  private readonly log = new Logger(AppController.name);
}
