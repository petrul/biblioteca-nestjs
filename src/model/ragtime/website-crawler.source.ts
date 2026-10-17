import * as cheerio from 'cheerio';
import { TextSource, TextIterable, TextItem, MemTextItem } from '../model/ragtime.model';

export interface CrawlerOptions {
  maxDepth?: number;
  maxPages?: number;
  allowedDomainOnly?: boolean;
}

export class RecursiveWebCrawlerIterable implements TextIterable<TextItem> {
  private visited = new Set<string>();

  constructor(
    private readonly startUrl: string,
    private readonly options: CrawlerOptions = {}
  ) {}

  private isSameDomain(targetUrl: string, baseUrl: string): boolean {
    try {
      const target = new URL(targetUrl);
      const base = new URL(baseUrl);
      return target.hostname === base.hostname;
    } catch {
      return false;
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<TextItem> {
    const maxDepth = this.options.maxDepth ?? 2;
    const maxPages = this.options.maxPages ?? 100;
    const allowedDomainOnly = this.options.allowedDomainOnly ?? true;

    const queue: { url: string; depth: number }[] = [{ url: this.startUrl, depth: 0 }];
    let pageCount = 0;

    while (queue.length > 0 && pageCount < maxPages) {
      const { url, depth } = queue.shift()!;

      if (this.visited.has(url) || depth > maxDepth) continue;
      this.visited.add(url);

      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'ScriptoriumRAGBot/1.0' },
        });

        if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
          continue;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        $('script, style, nav, footer, header, noscript').remove();
        const mainText = $('body').text().replace(/\s+/g, ' ').trim();

        if (mainText.length > 50) {
          pageCount++;
          yield new MemTextItem('web-crawler', url, mainText, { depth, title: $('title').text() });
        }

        if (depth < maxDepth) {
          $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            if (!href) return;

            try {
              const absoluteUrl = new URL(href, url).href;
              const cleanUrl = absoluteUrl.split('#')[0];

              if (
                !this.visited.has(cleanUrl) &&
                (!allowedDomainOnly || this.isSameDomain(cleanUrl, this.startUrl))
              ) {
                queue.push({ url: cleanUrl, depth: depth + 1 });
              }
            } catch {
              // Ignore invalid URLs
            }
          });
        }
      } catch (err) {
        console.warn(`Failed crawling ${url}:`, err);
      }
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

export class WebsiteTextSource implements TextSource {
  public readonly id = 'web-crawler';
  public readonly name: string;

  constructor(
    private readonly startUrl: string,
    private readonly options: CrawlerOptions = {}
  ) {
    this.name = `Web Crawler (${startUrl})`;
  }

  getItems(): TextIterable<TextItem> {
    return new RecursiveWebCrawlerIterable(this.startUrl, this.options);
  }

  async getItemById(id: string): Promise<TextItem | null> {
    return null;
  }
}