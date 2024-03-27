import { Controller, Post } from '@nestjs/common';
import { TextbaseClient } from './services/textbase_client.service';
import { VectorizerService } from './services/vectorizer.service';
import { StopWatch } from './util';

@Controller()
export class AppController {
  
  constructor(protected tbc: TextbaseClient, protected vectorizer: VectorizerService) {}

  @Post('/revectorize_all')
  async revectorizeAll(): Promise<any> {

    const opera = await this.tbc.getAllOpera(0, 2000);
    for (const op of opera) {
      const watch = new StopWatch();
      console.log(`will revectorize: ` + JSON.stringify(op));
      const opid = op.id;

      console.log(`starting vectorizing for ${opid}`);
      await this.vectorizer.vectorize(opid);
      console.log(`done vectorizing for ${opid}. took ${watch}`);
    }

  }
}
