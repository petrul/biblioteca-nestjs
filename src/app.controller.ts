import { Controller, Get, Post } from '@nestjs/common';
import { Api } from './textbase.api';
import { log } from 'console';
import { TextbaseClient } from './services/textbase_client.service';
import { VectorizerService } from './services/vectorizer.service';
// import { AppService } from './app.service';
// import {Api as TextbaseApi} from './textbase.api' 

@Controller()
export class AppController {
  
  constructor(protected tbc: TextbaseClient, protected vectorizer: VectorizerService) {}

  @Post('/revectorize_all')
  async revectorizeAll(): Promise<any> {

    const opera = await this.tbc.getAllOpera(0, 2000);
    for (const op of opera) {
      console.log(`will revectorize: ` + JSON.stringify(op));
      const opid = op.id;

      console.log(`starting vectorizing for ${opid}`);
      await this.vectorizer.vectorize(opid);
      console.log(`done vectorizing for ${opid}`);
    }

  }
}
