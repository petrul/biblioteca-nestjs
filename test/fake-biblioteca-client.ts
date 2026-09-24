import * as fs from 'fs';
import * as path from 'path';
import { Util } from '../src/util';

/**
 * Stand-in for BibliotecaClient that never makes a real HTTP call - used by
 * biblioteca_client.service.spec.ts and vectorizer.service.spec.ts instead of
 * the real one, which needs a live textbase-server (production is down as
 * often as it's up from here, and there's no other reachable instance with
 * real content - see the "forget textbase" conversation this replaces).
 *
 * Paragraph data comes from test/res/paras.json (real TEI paragraph shape,
 * previously-unused fixture data) - text_sha256 is recomputed from each
 * item's text rather than trusted from the file, since about half the
 * stored hashes there don't actually match their text (probably drifted
 * from some earlier text-normalization change) and
 * biblioteca_client.service.spec.ts asserts that invariant for real.
 *
 * paras.json is entirely Durkheim's "Cours de philosophie" - real French
 * text, tagged 'fr' here accordingly (it predates the `language` field and
 * has none of its own). A handful of synthetic English paragraphs are
 * appended so callers have real French-vs-English coverage for the
 * language-aware embedding filter (see VectorizerService) without needing
 * a second real fixture file.
 *
 * "Opera" (top-level book/work divs) are synthesized rather than loaded
 * from a fixture: biblioteca_client.service.spec.ts's allOperaGen() test
 * expects a catalog in the thousands (pagination across many pages), which
 * isn't something worth hand-authoring a fixture for.
 */
export class FakeBibliotecaClient {

    private static readonly TOTAL_FAKE_OPERA = 1200;

    private readonly paras: any[];

    constructor() {
        const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'res/paras.json'), 'utf-8'));
        const frenchParas = raw.map((p: any) => ({ ...p, text_sha256: Util.sha256AsHex(p.text), language: 'fr' }));

        const englishTexts = [
            'The quick brown fox jumps over the lazy dog near the riverbank.',
            'Textbase is a structured digital library for critical editions.',
            'Sentence transformers turn natural language into dense vector embeddings.',
        ];
        const englishParas = englishTexts.map((text, i) => ({
            name: 'p',
            path: `fake/english_fixture/_${i}`,
            url: `https://textbase.scriptorium.ro/fake/english_fixture/_${i}`,
            text,
            text_sha256: Util.sha256AsHex(text),
            language: 'en',
        }));

        // English first: callers that page/limit (e.g. `vectorize(..., 0, maxElems)`
        // with a small maxElems) should still see some embeddable content
        // within their first N items, not just the (STS-unsupported) French ones.
        this.paras = [...englishParas, ...frenchParas];
    }

    async getAuthors() {
        return [];
    }

    async getOperaForAuthor(_strId: string) {
        return [];
    }

    async getAllOpera(pageNr = 0, pageSize = 20) {
        const start = pageNr * pageSize;
        if (start >= FakeBibliotecaClient.TOTAL_FAKE_OPERA) return [];
        const end = Math.min(start + pageSize, FakeBibliotecaClient.TOTAL_FAKE_OPERA);
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
