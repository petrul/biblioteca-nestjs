import { TextSource, TextIterable, TextItem, MemTextItem } from '../model/ragtime.model';

export interface BookChapterDto {
  id: string;
  bookId: string;
  chapterTitle: string;
  content: string;
  canonicalUrl: string;
}

export class BibliotecaTextIterable implements TextIterable<TextItem> {
  constructor(private readonly baseUrl: string) {}

  async *[Symbol.asyncIterator](): AsyncIterator<TextItem> {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(`${this.baseUrl}/api/chapters?page=${page}&limit=20`);
      const data = (await response.json()) as { items: BookChapterDto[]; totalPages: number };

      for (const dto of data.items) {
        yield new MemTextItem(
          'biblioteca-scriptorium',
          dto.canonicalUrl,
          dto.content,
          { bookId: dto.bookId, title: dto.chapterTitle },
          dto.id
        );
      }

      hasMore = page < data.totalPages;
      page++;
    }
  }

  async *getBatches(batchSize: number): AsyncIterable<TextItem[]> {
    let batch: TextItem[] = [];
    for await (const item of this) {
      batch.push(item);
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length > 0) {
      yield batch;
    }
  }
}

export class BibliotecaScriptoriumSource implements TextSource {
  public readonly id = 'biblioteca-scriptorium';
  public readonly name = 'Biblioteca Scriptorium REST API';

  constructor(private readonly baseUrl: string = 'https://biblioteca.scriptorium.ro') {}

  getItems(): TextIterable<TextItem> {
    return new BibliotecaTextIterable(this.baseUrl);
  }

  async getItemById(id: string): Promise<TextItem | null> {
    const res = await fetch(`${this.baseUrl}/api/chapters/${id}`);
    if (!res.ok) return null;
    
    const dto = (await res.json()) as BookChapterDto;
    return new MemTextItem(
      this.id,
      dto.canonicalUrl,
      dto.content,
      { bookId: dto.bookId, title: dto.chapterTitle },
      dto.id
    );
  }
}