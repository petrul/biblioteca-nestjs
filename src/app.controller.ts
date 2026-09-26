import { Controller, Get, Post, Query } from '@nestjs/common';
import { MilvusCollection } from './services/milvus/milvuscollection.service';
import { VectorizingJobService, VectorizingStatus } from './services/vectorizing_job.service';
import { EntityModelTeiDiv } from './biblioteca.api';

const packageInfo: { name: string; version: string } = require('../package.json');

export interface AppInfo {
  name: string;
  version: string;
}


function enRoInFata(o1: EntityModelTeiDiv, o2: EntityModelTeiDiv) : number {
  if (o1.lang == o2.lang) return 0;
  if (o1.lang == 'EN') return -3; else
  if (o1.lang == 'RO') return -2; else
  if (o1.lang == 'FR') return -1; else
    return -o1.lang.localeCompare(o2.lang);

}

@Controller()
export class AppController {

  constructor(protected job: VectorizingJobService,
    protected col: MilvusCollection) {}

  @Get('/api/info')
  info(): AppInfo {
    return {
      name: packageInfo.name,
      version: packageInfo.version,
    };
  }

  /**
   * General status surface, deliberately apart from /api/vectorizing: it
   * embeds the vectorizing job's progress today and is the natural home
   * for other flags, configs and app-wide information over time.
   */
  @Get('/api/status')
  status(): { vectorizing: VectorizingStatus } {
    return { vectorizing: this.job.status() };
  }

  /** @deprecated use POST /api/vectorizing/start */
  @Post('/revectorize_all')
  async revectorizeAll(@Query('shuffle') shuffle: boolean = false): Promise<any> {
    return await this.job.start(shuffle);
  }

  /** @deprecated use POST /api/vectorizing/pause */
  @Post('/stop_vectorizing')
  stopVectorizing(): { stopped: boolean } {
    this.job.pause();
    return { stopped: true };
  }

  @Post('/optimize')
  async optimize() {
    return await this.col.compact();
  }
}
