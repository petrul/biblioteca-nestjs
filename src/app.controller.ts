import { Controller, Get } from '@nestjs/common';
import { Api } from './textbase.api';
import { log } from 'console';
import { TextbaseClient } from './services/textbase_client.service';
// import { AppService } from './app.service';
// import {Api as TextbaseApi} from './textbase.api' 

@Controller()
export class AppController {
  
  constructor(protected tbc: TextbaseClient) {}

  @Get('index')
  async doTheIndexing(): Promise<any> {



    // const toc = await this.tb.api.getIdToc(607938);
    // console.log(toc);

    // return JSON.stringify(toc.data);

  }
}
