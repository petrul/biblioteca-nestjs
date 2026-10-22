import { TeiElemDto } from "../src/biblioteca.api";
import { BibliotecaParagraphReader } from "../src/biblioteca-rag/biblioteca.source";
import { Util } from "../src/util";

/**
 * A small library served the way biblioteca-server serves it: works and
 * chapters as divs found by path, paragraphs read through their div in
 * reading order (a div's listing includes its descendants' paragraphs), each
 * paragraph's url being its div's path plus '/_N'.
 */
export class FakeParagraphReader implements BibliotecaParagraphReader {
    readonly paragraphReads: number[] = [];
    readonly pathLookups: string[] = [];
    private readonly divs = new Map<string, { id: number; head: string; author: string; texts: string[] }>();

    constructor(private readonly host = 'http://server:8080') {}

    /** Adds a div (a work when its path has two segments) with its own paragraphs. */
    div(path: string, head: string, author: string, texts: string[] = []): this {
        this.divs.set(path.replace(/^\/+/, ''), { id: this.divs.size + 1, head, author, texts });
        return this;
    }

    paragraph(path: string, n: number): TeiElemDto {
        const div = this.divs.get(path.replace(/^\/+/, ''))!;
        const text = div.texts[n - 1];
        return { text, text_sha256: Util.sha256AsHex(text), url: `${this.host}/${path.replace(/^\/+/, '')}/_${n}`, language: 'ro' } as TeiElemDto;
    }

    async getElemByPath(path: string) {
        this.pathLookups.push(path);
        const div = this.divs.get(path.replace(/^\/+/, ''));
        if (!div) throw new Error('404 not found');
        return { id: div.id, head: div.head, author: { displayName: div.author } };
    }

    async *getParagraphs(divId: number, _pageSize = 200, offset = 0, limit = Number.POSITIVE_INFINITY): AsyncGenerator<TeiElemDto> {
        this.paragraphReads.push(divId);
        const [path] = [...this.divs.entries()].find(([, div]) => div.id === divId) ?? [];
        if (!path) return;
        const all = [...this.divs.keys()].filter((p) => p === path || p.startsWith(`${path}/`))
            .flatMap((p) => this.divs.get(p)!.texts.map((_, i) => this.paragraph(p, i + 1)));
        for (const dto of all.slice(offset, offset + limit)) yield dto;
    }
}
