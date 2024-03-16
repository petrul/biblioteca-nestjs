import { Test, TestingModule } from '@nestjs/testing';
import { IndexerService } from './indexer.service';

describe('Indexer', () => {
  let indexer: IndexerService;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
        providers: [IndexerService],
    }).compile();

    indexer = app.get<IndexerService>(IndexerService);
  });

  describe('Indexer', () => {
    it('indexer should work', () => {
    //   expect(indexer.index).toBe('Hello World!');
        indexer.index()
    });
  });
});
