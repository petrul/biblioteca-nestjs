import { Controller, Get, Logger, Post, Query } from '@nestjs/common';
import { BibliotecaClient } from './services/biblioteca_client.service';
import { VectorizerService } from './services/vectorizer.service';
import { StopWatch, Util } from './util';
import { EntityModelTeiDiv } from './biblioteca.api';
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
  
  constructor(protected tbc: BibliotecaClient, 
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

    this.vectorizer.clearStop();

    // Truncate before the run: drop and recreate the collection so the pass
    // starts from an empty one. Re-vectorizing into the existing collection
    // would layer this run's insert binlogs on top of the previous rows' -
    // Milvus binlogs are append-only and delete/upsert deltas are only
    // reaped by a lazy GC - so a full re-run onto a stale collection leaves
    // tens of GB of unreclaimed MinIO objects (observed in prod: 40G of
    // binlogs for a collection holding ~3% of the corpus). drop() releases
    // the collection from memory first; createAndLoadIfNotExists() then
    // rebuilds it with the same schema, index and load state as at startup.
    // A stop requested mid-run leaves the collection partial - by design:
    // a truncated revectorize is exactly that until it completes.
    this.log.log('revectorize_all: truncating collection...');
    await this.col.drop();
    await this.col.createAndLoadIfNotExists();
    this.log.log('revectorize_all: collection truncated.');

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
      if (this.vectorizer.isStopRequested()) {
        this.log.log('Stop requested - halting revectorize_all.');
        break;
      }
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

  @Post('/stop_vectorizing')
  stopVectorizing(): { stopped: boolean } {
    this.vectorizer.requestStop();
    return { stopped: true };
  }

  @Post('/optimize')
  async optimize() {
    return await this.col.compact();
  }

  private readonly log = new Logger(AppController.name);
}
