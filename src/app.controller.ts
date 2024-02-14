import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import {Api as TextbaseApi} from './textbase.api' 

@Controller()
export class AppController {
  protected tb: TextbaseApi<string>
  constructor(private readonly appService: AppService,
    ) {
      this.tb = new TextbaseApi({
        baseUrl: 'http://localhost:8080',
        baseApiParams: {
          headers: {
            Accept: 'application/json',
          }
        }
      })
    }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }


  @Get('pulea')
  async doSmth(): Promise<string> {
    // return 'pulea';
    // const authors = await this.tb.api.getCollectionResourceAuthorGet1({
    //   page: 0,
    //   size: 15
    // })
    // getAuthors();
    // console.log(authors);
    // this.tb.api.teidi
    // return authors.text();

    const toc = await this.tb.api.getIdToc(607938);
    console.log(toc);

    return JSON.stringify(toc.data);

  }
}
