import * as cheerio from 'cheerio';
import { TextSource, TextIterable, TextItem, MemTextItem, batchesOf } from '../core';

export interface CrawlerOptions {
  maxDepth?: number;
  maxPages?: number;
  allowedDomainOnly?: boolean;
  /** Pause between two page fetches, to stay polite to the site. Default 500 ms. */
  delayMs?: number;
}

export class RecursiveWebCrawlerIterable implements TextIterable<TextItem> {
  private readonly visited = new Set<string>();

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
    this.visited.clear(); // every iteration crawls afresh
    const maxDepth = this.options.maxDepth ?? 2;
    const maxPages = this.options.maxPages ?? 100;
    const allowedDomainOnly = this.options.allowedDomainOnly ?? true;

    const queue: { url: string; depth: number }[] = [{ url: this.startUrl, depth: 0 }];
    let pageCount = 0;

    while (queue.length > 0 && pageCount < maxPages) {
      const { url, depth } = queue.shift()!;

      if (this.visited.has(url) || depth > maxDepth) continue;
      this.visited.add(url);
      if (this.visited.size > 1) await new Promise((resolve) => setTimeout(resolve, this.options.delayMs ?? 500));

      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'ScriptoriumRAGBot/1.0' },
        });

        if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
          continue;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // links first: navigation and footers are left out of the text, not out of the crawl
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

        $('script, style, nav, footer, header, noscript, aside, form').remove();
        // one block per paragraph-like element: the text keeps its paragraph
        // structure (blank lines between blocks) for a TextSplitter
        const root = $('main, article').first().length ? $('main, article').first() : $('body');
        const blocks = root.find('h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, td, dd')
          .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
        const mainText = (blocks.length ? blocks.join('\n\n') : root.text().replace(/\s+/g, ' ')).trim();

        if (mainText.length > 50) {
          pageCount++;
          const title = $('title').text().trim() || undefined;
          const language = ($('html').attr('lang') ?? '').slice(0, 2).toLowerCase() || undefined;
          yield new MemTextItem('web-crawler', url, mainText, { depth }, { title, language });
        }

      } catch (err) {
        console.warn(`Failed crawling ${url}:`, err);
      }
    }
  }

  getBatches(batchSize: number): AsyncIterable<TextItem[]> {
    return batchesOf(this, batchSize);
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

  /** Pages are not addressable by id (a hash of url and content): search results resolve by their url. */
  async getItemById(): Promise<TextItem | null> {
    return null;
  }
}