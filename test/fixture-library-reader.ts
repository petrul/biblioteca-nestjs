import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TeiElemDto } from "../src/biblioteca.api";
import { BibliotecaParagraphReader } from "../src/biblioteca-rag/biblioteca.source";
import { Util } from "../src/util";

interface LibraryFixture {
    source: string;
    divs: Record<string, { head: string; author: string }>;
    paragraphs: { path: string; text: string; language?: string }[];
}

/**
 * A work saved from biblioteca-server (test/res/<name>.json: its divs with
 * their heads, its paragraphs in reading order), served the way the server
 * serves it: divs by path, a div's paragraphs - its descendants' included -
 * by div id, each paragraph's url its path under the server's host.
 */
export class FixtureLibraryReader implements BibliotecaParagraphReader {
    private readonly fixture: LibraryFixture;
    private readonly ids: Map<string, number>;

    constructor(name: string, private readonly host = 'http://server:8080') {
        this.fixture = JSON.parse(readFileSync(join(__dirname, 'res', `${name}.json`), 'utf8'));
        this.ids = new Map(Object.keys(this.fixture.divs).map((path, idx) => [path, idx + 1]));
    }

    /** The id of the fixture's work (its shortest div path). */
    get opusId(): number {
        return this.ids.get(this.opusPath)!;
    }

    get opusPath(): string {
        return Object.keys(this.fixture.divs).sort((a, b) => a.length - b.length)[0];
    }

    async getElemByPath(path: string) {
        const key = path.replace(/^\/+|\/+$/g, '');
        const div = this.fixture.divs[key];
        if (!div) throw new Error(`404 no div ${key}`);
        return { id: this.ids.get(key), head: div.head, author: { displayName: div.author } };
    }

    async *getParagraphs(divId: number, _pageSize = 200, offset = 0, limit = Number.POSITIVE_INFINITY): AsyncGenerator<TeiElemDto> {
        const divPath = [...this.ids.entries()].find(([, id]) => id === divId)?.[0];
        if (!divPath) return;
        const paragraphs = this.fixture.paragraphs.filter(p => p.path.startsWith(`${divPath}/`));
        for (const p of paragraphs.slice(offset, offset + limit)) {
            yield { text: p.text, text_sha256: Util.sha256AsHex(p.text), url: `${this.host}/${p.path}`, language: p.language } as TeiElemDto;
        }
    }
}
