import * as fs from 'fs';
import * as path from 'path';
import { Util } from '../src/util';

/**
 * Stand-in for TextbaseClient that never makes a real HTTP call - used by
 * textbase_client.service.spec.ts and vectorizer.service.spec.ts instead of
 * the real one, which needs a live textbase-server (production is down as
 * often as it's up from here, and there's no other reachable instance with
 * real content - see the "forget textbase" conversation this replaces).
 *
 * Paragraph data comes from test/res/paras.json (real TEI paragraph shape,
 * previously-unused fixture data) - text_sha256 is recomputed from each
 * item's text rather than trusted from the file, since about half the
 * stored hashes there don't actually match their text (probably drifted
 * from some earlier text-normalization change) and
 * textbase_client.service.spec.ts asserts that invariant for real.
 *
 * "Opera" (top-level book/work divs) are synthesized rather than loaded
 * from a fixture: textbase_client.service.spec.ts's allOperaGen() test
 * expects a catalog in the thousands (pagination across many pages), which
 * isn't something worth hand-authoring a fixture for.
 */
export class FakeTextbaseClient {

    private static readonly TOTAL_FAKE_OPERA = 1200;

    private readonly paras: any[];

    constructor() {
        const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'res/paras.json'), 'utf-8'));
        this.paras = raw.map((p: any) => ({ ...p, text_sha256: Util.sha256AsHex(p.text) }));
    }

    async getAuthors() {
        return [];
    }

    async getOperaForAuthor(_strId: string) {
        return [];
    }

    async getAllOpera(pageNr = 0, pageSize = 20) {
        const start = pageNr * pageSize;
        if (start >= FakeTextbaseClient.TOTAL_FAKE_OPERA) return [];
        const end = Math.min(start + pageSize, FakeTextbaseClient.TOTAL_FAKE_OPERA);
        return Array.from({ length: end - start }, (_, i) => {
            const id = start + i + 1;
            return { id, head: `Fake Opus ${id}`, leaf: false, path: `fake/opus_${id}` };
        });
    }

    async getElemByPath(reqPath: string) {
        // echoes back whatever path was asked for (leading slash stripped,
        // matching how the real API normalizes it) instead of hardcoding one
        // specific book, so any caller's expected path always matches
        const cleanPath = reqPath.replace(/^\//, '');
        return { id: 1, path: cleanPath, head: 'Fake root', leaf: false };
    }

    async *getParagraphs(_opId: number, _pageSize = 1000, offset = 0, limit = Number.POSITIVE_INFINITY) {
        let totalYielded = 0;
        for (let i = offset; i < this.paras.length; i++) {
            if (totalYielded++ >= limit) return;
            yield this.paras[i];
        }
    }

    protected async *gen<T>(
        provider: (pageNr: number, pageSize: number) => Promise<Array<T>>,
        pageNr = 0,
        pageSize = 1000,
        limit = Number.POSITIVE_INFINITY,
    ): AsyncGenerator<T, void, unknown> {
        let hasMore = true;
        let totalYielded = 0;

        while (hasMore) {
            const arr = await provider(pageNr, pageSize);
            pageNr++;
            hasMore = (arr.length == pageSize);

            for (const obj of arr) {
                if (totalYielded++ >= limit) return;
                yield obj;
            }
        }
    }

    allOperaGen(pageNr = 0, pageSize = 1000, limit = Number.POSITIVE_INFINITY) {
        return this.gen((p, s) => this.getAllOpera(p, s), pageNr, pageSize, limit);
    }
}
