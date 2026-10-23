import { TeiElemDto } from '../biblioteca.api';
import {
  CollectionSpec,
  MemoryKeywordIndex,
  Retriever,
  RetrieveOptions,
  ContentResolver,
  ContextExpander,
  GeneratorTextIterable,
  MemTextItem,
  SearchResultItem,
  TextItem,
  TextIterable,
  TextSource,
  VectorFilter,
  VectorQueryResult,
} from '../ragtime/core';
import { QdrantCollectionTuning } from '../ragtime/adapters/qdrant.vector-store';

/**
 * Biblioteca as a ragtime TextSource: the paragraphs of its works, read
 * through biblioteca-server's REST API (GET /api/divs/{id}/paras).
 *
 * A paragraph's id is its text's sha256 - its identity across renames: a
 * renamed work moves every paragraph URL (author/work are in it), never its
 * vectors. The stored payload is { sha256, url, opus_path } (see
 * bibliotecaPayload); biblioteca-server's own vector search reads the same
 * collection, so that layout and the point ids are shared with it.
 */

/** The paragraph-reading part of BibliotecaClient this needs. */
export interface BibliotecaParagraphReader {
  getParagraphs(divId: number, pageSize?: number, offset?: number, limit?: number): AsyncGenerator<TeiElemDto>;
  getElemByPath(path: string): Promise<{ id?: number; head?: string; author?: { displayName?: string } }>;
}

export const BIBLIOTECA_SOURCE_ID = 'biblioteca';

export const BibliotecaPayload = Object.freeze({
  SHA256: 'sha256',
  URL: 'url',
  OPUS_PATH: 'opus_path',
});

/** What a Biblioteca paragraph collection is: Euclid like the server's search, exact-match fields indexed. */
export function bibliotecaCollectionSpec(dimension: number): CollectionSpec {
  return {
    dimension,
    metric: 'euclid',
    indexedFields: [BibliotecaPayload.SHA256, BibliotecaPayload.URL, BibliotecaPayload.OPUS_PATH],
  };
}

/** HNSW as the server's collections have it; int8 because the full-precision corpus would not fit in RAM. */
export const BIBLIOTECA_QDRANT_TUNING: QdrantCollectionTuning = Object.freeze({
  hnsw: { m: 16, ef_construct: 100 },
  int8Quantization: true,
});

/** 'author/opus' of a paragraph URL (its first two path segments); '' for anything unparseable. */
export function opusPathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/+/, '').split('/').slice(0, 2).join('/');
  } catch {
    return '';
  }
}

/** A work's path as 'author/opus', whatever slashes or deeper path it came with. */
export function normalizeOpusPath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, '').split('/').slice(0, 2).join('/');
}

export class BibliotecaParagraph extends MemTextItem {
  constructor(text: string, readonly sha256: string, url: string, language?: string, title?: string) {
    super(BIBLIOTECA_SOURCE_ID, url, text,
      { [BibliotecaPayload.SHA256]: sha256, [BibliotecaPayload.OPUS_PATH]: opusPathOf(url) },
      { id: sha256, language, title });
  }

  get opusPath(): string {
    return this.metadata[BibliotecaPayload.OPUS_PATH] as string;
  }

  withTitle(title: string | undefined): BibliotecaParagraph {
    return title ? new BibliotecaParagraph(this.text, this.sha256, this.url, this.language, title) : this;
  }

  /** null for a paragraph the server sent without text, hash or URL. */
  static fromDto(dto: TeiElemDto): BibliotecaParagraph | null {
    if (dto.text == null || !dto.text_sha256 || !dto.url) return null;
    return new BibliotecaParagraph(dto.text, dto.text_sha256, dto.url, dto.language ?? undefined);
  }
}

/** The vector payload of a paragraph - the layout every stored Biblioteca vector has. */
export function bibliotecaPayload(paragraph: BibliotecaParagraph): Record<string, unknown> {
  return {
    [BibliotecaPayload.SHA256]: paragraph.sha256,
    [BibliotecaPayload.URL]: paragraph.url,
    [BibliotecaPayload.OPUS_PATH]: paragraph.opusPath,
  };
}

/**
 * Where to search or chat: one work ("chat with a book"), several (a
 * collection), or - with no works - the whole library.
 */
export interface BibliotecaScope {
  opusPaths?: readonly string[];
}

/** The filter of a scope; undefined (the whole library) when it names no valid work. */
export function bibliotecaFilter(scope: BibliotecaScope = {}): VectorFilter | undefined {
  const paths = [...new Set((scope.opusPaths ?? []).map(normalizeOpusPath).filter((path) => path.includes('/')))];
  return paths.length > 0 ? { [BibliotecaPayload.OPUS_PATH]: paths } : undefined;
}

export interface BibliotecaDivSourceOptions {
  pageSize?: number;
  offset?: number;
  limit?: number;
}

/** The paragraphs of one div - usually a whole work - in reading order. */
export class BibliotecaDivSource implements TextSource<BibliotecaParagraph> {
  readonly id = BIBLIOTECA_SOURCE_ID;
  readonly name: string;

  constructor(
    private readonly reader: BibliotecaParagraphReader,
    private readonly divId: number,
    private readonly options: BibliotecaDivSourceOptions = {},
  ) {
    this.name = `Biblioteca div ${divId}`;
  }

  getItems(): TextIterable<BibliotecaParagraph> {
    const { reader, divId, options } = this;
    return new GeneratorTextIterable(async function* () {
      for await (const dto of reader.getParagraphs(divId, options.pageSize, options.offset, options.limit)) {
        const paragraph = BibliotecaParagraph.fromDto(dto);
        if (paragraph) yield paragraph;
      }
    });
  }

  /** Paragraphs are found by URL, not by hash: see BibliotecaContentResolver. */
  async getItemById(): Promise<BibliotecaParagraph | null> {
    return null;
  }
}

/** The decoded path of a URL, without host: the same paragraph is served under several hosts. */
export function pathOf(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** A bounded map that forgets its oldest entries. */
class Lru<K, V> {
  private readonly entries = new Map<K, V>();
  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as K);
  }
}

interface DivInfo {
  id: number;
  title?: string;
}

export interface BibliotecaContentResolverOptions {
  pageSize?: number;
  /** Paragraphs read per div at most, so a hit in a huge div cannot read the whole work. */
  maxScan?: number;
  /** Paragraphs read past the last hit of a div, kept for BibliotecaContextExpander. Default 1. */
  lookahead?: number;
}

/**
 * Resolves Biblioteca vector matches to their paragraphs. A paragraph URL is
 * its div's path plus '/_N' (the N-th paragraph of that div), and the server
 * reads paragraphs only through their div: so each distinct div is found by
 * path once (cached, with its title), and its paragraphs are read in order
 * until the wanted ones turn up. A paragraph whose text no longer has the
 * stored hash, or whose div is gone, resolves to null.
 *
 * The paragraphs read on the way are remembered for a while, so that
 * neighboursOf can widen a hit without asking the server again.
 */
export class BibliotecaContentResolver implements ContentResolver<BibliotecaParagraph> {
  private readonly divs = new Lru<string, DivInfo>(10_000);
  private readonly works = new Lru<string, string>(10_000);
  private readonly read = new Lru<string, BibliotecaParagraph[]>(500);

  constructor(
    private readonly reader: BibliotecaParagraphReader,
    private readonly options: BibliotecaContentResolverOptions = {},
  ) {}

  async resolve(match: VectorQueryResult): Promise<BibliotecaParagraph | null> {
    return (await this.resolveBatch([match]))[0];
  }

  async resolveBatch(matches: VectorQueryResult[]): Promise<(BibliotecaParagraph | null)[]> {
    const wanted = matches.map((match) => {
      const url = match.payload[BibliotecaPayload.URL];
      const path = typeof url === 'string' ? pathOf(url) : null;
      const sha256 = match.payload[BibliotecaPayload.SHA256] ?? match.id;
      return path ? { path, divPath: path.substring(0, path.lastIndexOf('/')), sha256 } : null;
    });
    const byDiv = new Map<string, Set<string>>();
    for (const it of wanted) if (it) byDiv.set(it.divPath, (byDiv.get(it.divPath) ?? new Set()).add(it.path));

    const found = new Map<string, BibliotecaParagraph>();
    await Promise.all([...byDiv.entries()].map(async ([divPath, paths]) => {
      for (const paragraph of await this.paragraphsOf(divPath, paths)) found.set(pathOf(paragraph.url)!, paragraph);
    }));

    return wanted.map((it) => {
      const paragraph = it && found.get(it.path);
      return paragraph && paragraph.sha256 === it.sha256 ? paragraph : null;
    });
  }

  /** The paragraphs before and after one resolved earlier, as far as they were read. */
  neighboursOf(paragraph: TextItem, before: number, after: number): { before: BibliotecaParagraph[]; after: BibliotecaParagraph[] } {
    const path = pathOf(paragraph.url);
    const divPath = path?.substring(0, path.lastIndexOf('/'));
    const read = divPath ? this.read.get(divPath) ?? [] : [];
    const idx = read.findIndex((it) => pathOf(it.url) === path);
    if (idx < 0) return { before: [], after: [] };
    return { before: read.slice(Math.max(0, idx - before), idx), after: read.slice(idx + 1, idx + 1 + after) };
  }

  private async paragraphsOf(divPath: string, paths: Set<string>): Promise<BibliotecaParagraph[]> {
    const div = await this.div(divPath);
    if (!div) return [];
    const result: BibliotecaParagraph[] = [];
    const read: BibliotecaParagraph[] = [];
    let lookahead = this.options.lookahead ?? 1;
    for await (const dto of this.reader.getParagraphs(div.id, this.options.pageSize ?? 200, 0, this.options.maxScan ?? 10_000)) {
      const paragraph = BibliotecaParagraph.fromDto(dto)?.withTitle(div.title);
      if (!paragraph) continue;
      if (result.length === paths.size && lookahead-- <= 0) break;
      read.push(paragraph);
      if (result.length < paths.size && paths.has(pathOf(paragraph.url)!)) result.push(paragraph);
    }
    this.read.set(divPath, read);
    return result;
  }

  /** A div by path, with "Author, Work - Chapter" as its title; null when gone (removed, renamed away). */
  private async div(divPath: string): Promise<DivInfo | null> {
    const cached = this.divs.get(divPath);
    if (cached) return cached;
    try {
      const dto = await this.reader.getElemByPath(divPath);
      if (dto.id == null) return null;
      const opusPath = normalizeOpusPath(divPath);
      const work = await this.workTitle(opusPath, dto);
      const chapter = normalizeOpusPath(divPath) === divPath.replace(/^\/+/, '') ? undefined : dto.head?.trim();
      const info = { id: dto.id, title: [work, chapter].filter(Boolean).join(' - ') || undefined };
      // only found divs are remembered: a reimported work resolves again at once
      this.divs.set(divPath, info);
      return info;
    } catch {
      return null;
    }
  }

  private async workTitle(opusPath: string, div: { head?: string; author?: { displayName?: string } }): Promise<string | undefined> {
    const cached = this.works.get(opusPath);
    if (cached !== undefined) return cached || undefined;
    let title = '';
    try {
      const opus = await this.reader.getElemByPath(`/${opusPath}`);
      title = [opus.author?.displayName ?? div.author?.displayName, opus.head?.trim()].filter(Boolean).join(', ');
    } catch {
      title = div.author?.displayName ?? '';
    }
    this.works.set(opusPath, title);
    return title || undefined;
  }
}

/**
 * Widens each hit with the paragraphs around it - a paragraph of a book is
 * rarely understandable alone. Reads only what the resolver already read
 * (the hit's preceding paragraphs and its lookahead).
 */
export class BibliotecaContextExpander implements ContextExpander<BibliotecaParagraph> {
  constructor(
    private readonly resolver: BibliotecaContentResolver,
    private readonly before = 1,
    private readonly after = 1,
  ) {}

  async expand(results: SearchResultItem<BibliotecaParagraph>[]): Promise<TextItem[]> {
    return results.map(({ item }) => {
      const { before, after } = this.resolver.neighboursOf(item, this.before, this.after);
      if (before.length === 0 && after.length === 0) return item;
      const text = [...before, item, ...after].map((it) => it.text).join('\n\n');
      return new MemTextItem(item.sourceId, item.url, text, { ...item.metadata, expanded: true },
        { id: item.id, title: item.title, language: item.language });
    });
  }
}

export interface BibliotecaKeywordRetrieverOptions {
  /** Scopes of more works than this get no keyword search (each work is read whole once). Default 5. */
  maxWorks?: number;
  /** Works kept indexed in memory. Default 20. */
  maxCachedWorks?: number;
}

/**
 * Keyword (BM25) search within a scope of a few works - exact names and terms
 * that embeddings blur ("Fezziwig", "turkey"). Each work of the scope is read
 * once, lazily, through its div and kept indexed (least recently used works
 * forgotten). Library-wide searches get no keyword candidates.
 */
export class BibliotecaKeywordRetriever implements Retriever {
  private readonly index = new MemoryKeywordIndex();
  /** Works indexed (or being indexed), least recently used first. */
  private readonly works = new Map<string, Promise<boolean>>();

  constructor(
    private readonly reader: BibliotecaParagraphReader,
    private readonly options: BibliotecaKeywordRetrieverOptions = {},
  ) {}

  async retrieve(query: string, _collection: string, options: RetrieveOptions): Promise<VectorQueryResult[]> {
    const scoped = options.filter?.[BibliotecaPayload.OPUS_PATH];
    const works = (Array.isArray(scoped) ? scoped : scoped ? [scoped] : []).map(String);
    if (works.length === 0 || works.length > (this.options.maxWorks ?? 5)) return [];
    const ready = await Promise.all(works.map((work) => this.load(work)));
    const lists = await Promise.all(works.filter((_, i) => ready[i]).map((work) => this.index.retrieve(query, work, options)));
    return lists.flat().sort((a, b) => b.score - a.score).slice(0, options.topK);
  }

  private load(work: string): Promise<boolean> {
    let loading = this.works.get(work);
    if (loading) {
      this.works.delete(work); // most recently used: last
    } else {
      loading = this.read(work).catch(() => {
        this.forget(work); // gone, or the server failed: tried again next time
        return false;
      });
    }
    this.works.set(work, loading);
    while (this.works.size > (this.options.maxCachedWorks ?? 20)) this.forget(this.works.keys().next().value as string);
    return loading;
  }

  private forget(work: string): void {
    this.works.delete(work);
    this.index.drop(work);
  }

  private async read(work: string): Promise<boolean> {
    const opus = await this.reader.getElemByPath(`/${work}`);
    if (opus.id == null) return false;
    const items: { id: string; text: string; payload: Record<string, unknown> }[] = [];
    for await (const paragraph of new BibliotecaDivSource(this.reader, opus.id).getItems()) {
      items.push({ id: paragraph.id, text: paragraph.text, payload: bibliotecaPayload(paragraph) });
    }
    await this.index.add(work, items);
    return true;
  }
}
