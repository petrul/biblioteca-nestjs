/// <reference types="jest" />
import { VectorQueryResult } from '../ragtime/core';
import { FakeParagraphReader } from '../../test/fake-paragraph-reader';
import {
  BibliotecaContentResolver,
  BibliotecaContextExpander,
  BibliotecaDivSource,
  BibliotecaKeywordRetriever,
  BibliotecaParagraph,
  bibliotecaFilter,
  bibliotecaPayload,
  normalizeOpusPath,
  opusPathOf,
} from './biblioteca.source';

const CHAPTER = 'creanga/amintiri/partea_i';
const library = () => new FakeParagraphReader()
  .div('creanga/amintiri', 'Amintiri din copilărie', 'Ion Creangă', ['Prefață scurtă.'])
  .div(CHAPTER, 'Partea I', 'Ion Creangă', ['Stau câteodată și-mi aduc aminte.', 'Nică fura cireșe.', 'Mătușa Mărioara îl prinde.', 'Fuge acasă.'])
  .div('eminescu/luceafarul', 'Luceafărul', 'Mihai Eminescu', ['A fost odată ca-n povești.']);

const match = (reader: FakeParagraphReader, path: string, n: number, sha256?: string): VectorQueryResult => {
  const dto = reader.paragraph(path, n);
  return { id: dto.text_sha256!, score: 0.5, scoreKind: 'distance', payload: { sha256: sha256 ?? dto.text_sha256, url: dto.url } };
};

describe('Biblioteca paths', () => {
  it('derives author/opus from a paragraph url, host-agnostic, never confusing a longer sibling', () => {
    expect(opusPathOf('http://server:8080/bacon/the_essays/of_gardens/_1')).toBe('bacon/the_essays');
    expect(opusPathOf('http://server:8080/seneca/de-vita/p0')).toBe(opusPathOf('https://biblioteca.scriptorium.ro/seneca/de-vita/p0'));
    expect(opusPathOf('https://x/seneca/de-vita-longa/p0')).toBe('seneca/de-vita-longa');
    expect(opusPathOf('not a url')).toBe('');
  });

  it('normalizes scope paths and builds the work filter; no valid work means the whole library', () => {
    expect(normalizeOpusPath('/creanga/amintiri/partea_i/')).toBe('creanga/amintiri');
    expect(bibliotecaFilter({ opusPaths: ['/creanga/amintiri/', 'creanga/amintiri', 'eminescu/luceafarul/x'] }))
      .toEqual({ opus_path: ['creanga/amintiri', 'eminescu/luceafarul'] });
    expect(bibliotecaFilter({ opusPaths: ['creanga'] })).toBeUndefined();
    expect(bibliotecaFilter()).toBeUndefined();
  });
});

describe('BibliotecaDivSource', () => {
  it("yields a work's paragraphs in reading order, identified by their sha256, with the server's payload layout", async () => {
    const reader = library();
    const items: BibliotecaParagraph[] = [];
    for await (const item of new BibliotecaDivSource(reader, 1).getItems()) items.push(item);
    expect(items.map((it) => it.text)).toEqual(['Prefață scurtă.', 'Stau câteodată și-mi aduc aminte.', 'Nică fura cireșe.', 'Mătușa Mărioara îl prinde.', 'Fuge acasă.']);
    const dto = reader.paragraph(CHAPTER, 2);
    expect(items[2]).toMatchObject({ id: dto.text_sha256, sha256: dto.text_sha256, url: dto.url, language: 'ro', opusPath: 'creanga/amintiri' });
    expect(bibliotecaPayload(items[2])).toEqual({ sha256: dto.text_sha256, url: dto.url, opus_path: 'creanga/amintiri' });
  });

  it('skips paragraphs the server sent without text, hash or url', () => {
    expect(BibliotecaParagraph.fromDto({ text: 'x', url: 'http://s/a/b/_1' })).toBeNull();
    expect(BibliotecaParagraph.fromDto({ text_sha256: 'h', url: 'http://s/a/b/_1' })).toBeNull();
  });
});

describe('BibliotecaContentResolver', () => {
  it('resolves hits through their div, once per div, titled "Author, Work - Chapter", in the order of the hits', async () => {
    const reader = library();
    const resolver = new BibliotecaContentResolver(reader);
    const resolved = await resolver.resolveBatch([match(reader, CHAPTER, 3), match(reader, 'eminescu/luceafarul', 1), match(reader, CHAPTER, 2)]);
    expect(resolved.map((it) => it?.text)).toEqual(['Mătușa Mărioara îl prinde.', 'A fost odată ca-n povești.', 'Nică fura cireșe.']);
    expect(resolved[0]!.title).toBe('Ion Creangă, Amintiri din copilărie - Partea I');
    expect(resolved[1]!.title).toBe('Mihai Eminescu, Luceafărul');
    expect(reader.paragraphReads).toHaveLength(2); // one read per distinct div

    await resolver.resolveBatch([match(reader, CHAPTER, 1)]);
    expect(reader.pathLookups.filter((p) => p === `/${CHAPTER}`)).toHaveLength(1); // the div lookup is cached
  });

  it('resolves to null when the text changed since it was embedded, or the work is gone', async () => {
    const reader = library();
    const resolver = new BibliotecaContentResolver(reader);
    const changed = match(reader, CHAPTER, 2, 'f'.repeat(64));
    const gone: VectorQueryResult = { id: 'x', score: 1, scoreKind: 'distance', payload: { sha256: 'x', url: 'http://server:8080/removed/work/_1' } };
    expect(await resolver.resolveBatch([changed, gone, match(reader, CHAPTER, 4)]))
      .toEqual([null, null, expect.objectContaining({ text: 'Fuge acasă.' })]);
  });

  it('resolves the same paragraph served under another host', async () => {
    const reader = library();
    const hit = match(reader, CHAPTER, 2);
    hit.payload.url = String(hit.payload.url).replace('http://server:8080', 'https://biblioteca.scriptorium.ro');
    expect((await new BibliotecaContentResolver(reader).resolve(hit))?.text).toBe('Nică fura cireșe.');
  });
});

describe('BibliotecaContextExpander', () => {
  it('widens each hit with the paragraphs around it, one expanded item per hit', async () => {
    const reader = library();
    const resolver = new BibliotecaContentResolver(reader);
    const [hit] = await resolver.resolveBatch([match(reader, CHAPTER, 2)]);
    const [expanded] = await new BibliotecaContextExpander(resolver).expand([{ item: hit!, score: 0.5, scoreKind: 'distance' }]);
    expect(await expanded.getText()).toBe('Stau câteodată și-mi aduc aminte.\n\nNică fura cireșe.\n\nMătușa Mărioara îl prinde.');
    expect(expanded).toMatchObject({ id: hit!.id, url: hit!.url, title: hit!.title });
  });
});

describe('BibliotecaKeywordRetriever', () => {
  it('searches the words of the scoped works only, reading each work once', async () => {
    const reader = library();
    const retriever = new BibliotecaKeywordRetriever(reader);
    const hits = await retriever.retrieve('cireșe', 'c', { topK: 5, filter: { opus_path: ['creanga/amintiri'] } });
    expect(hits).toHaveLength(1);
    expect(hits[0].payload).toEqual({ ...match(reader, CHAPTER, 2).payload, opus_path: 'creanga/amintiri' });
    await retriever.retrieve('Mătușa', 'c', { topK: 5, filter: { opus_path: 'creanga/amintiri' } });
    expect(reader.paragraphReads).toHaveLength(1);
  });

  it('gives nothing library-wide or for too wide a scope, and forgets a work that is gone', async () => {
    const reader = library();
    const retriever = new BibliotecaKeywordRetriever(reader, { maxWorks: 1 });
    expect(await retriever.retrieve('cireșe', 'c', { topK: 5 })).toEqual([]);
    expect(await retriever.retrieve('cireșe', 'c', { topK: 5, filter: { opus_path: ['creanga/amintiri', 'eminescu/luceafarul'] } })).toEqual([]);
    expect(await retriever.retrieve('x', 'c', { topK: 5, filter: { opus_path: 'removed/work' } })).toEqual([]);
    expect(await retriever.retrieve('x', 'c', { topK: 5, filter: { opus_path: 'removed/work' } })).toEqual([]);
    expect(reader.pathLookups.filter((p) => p === '/removed/work')).toHaveLength(2); // looked up again: not cached as gone
  });
});
