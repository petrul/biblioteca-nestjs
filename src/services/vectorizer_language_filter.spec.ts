/// <reference types="jest" />
import { VectorizerService } from './vectorizer.service';
import { BibliotecaClient } from './biblioteca_client.service';
import { Content, ContentEmbedder } from '../model/model';
import { SharedTextbaseConfig } from '../configuration';
import { VectorStore } from './vector_store';
import { TeiElemDto } from '../biblioteca.api';

/**
 * Ports the language-aware embedding filter test from the retired
 * milvus-backed vectorizer.service.spec.ts (skipped there: milvus is gone,
 * the store path is qdrant). The filter is store- and embedder-independent
 * production logic: an encoder that only speaks some languages (e.g. the
 * English-only all-MiniLM-L6-v2 STS model) must not silently embed
 * paragraphs it was never trained on, and an undetected language is
 * treated the same as an unsupported one - see VectorizerService.vectorize.
 *
 * All mocks, same pattern as vector_reuse.spec.ts: nothing touches a real
 * embedder, store or textbase-server.
 */

function para(text: string, sha256: string, url: string, language?: string): TeiElemDto {
    return { text, text_sha256: sha256, url, language } as TeiElemDto;
}

class FakeTbc {
    pages: TeiElemDto[][] = [];
    constructor(pages: TeiElemDto[][]) { this.pages = pages; }
    // No-op stand-ins: these report stats to biblioteca-server, never
    // asserted here.
    async recordEmbeddingBatchStat(): Promise<void> { /* no-op */ }
    async recordOpusVectorizingStat(): Promise<void> { /* no-op */ }
    getParagraphs(_divId: number, pageSize: number): AsyncGenerator<TeiElemDto> {
        const flat = this.pages.flat();
        return (async function* () {
            for (let i = 0; i < flat.length; i += pageSize)
                yield* flat.slice(i, i + pageSize);
        })();
    }
}

// The English-only stand-in for AllMiniLmL6V2_StsService. Every embeddings
// call is recorded - the assertion surface for "what did the filter let
// through".
class EnglishOnlyEmbedder implements ContentEmbedder {
    readonly supportedLanguages = ['en'];
    readonly maxContextChars = 100_000;
    readonly calls: string[][] = [];
    async embeddings(content: Content[]): Promise<Content[]> {
        this.calls.push(content.map(it => it.sha256));
        // Mutate in place, exactly like the real embedders do.
        content.forEach(it => { it.embedding = it.sha256.split('').map(c => c.charCodeAt(0)); });
        return content;
    }
    embeddedShas(): string[] { return this.calls.flat(); }
}

class FakeStore implements VectorStore {
    rows = new Map<string, { url: string; embedding: number[] }>();
    readonly removeOpus = jest.fn();
    readonly reset = jest.fn();
    async store(data: Content[]) {
        data.forEach(it => this.rows.set(it.sha256, { url: it.url, embedding: it.embedding }));
    }
    async storeNewOrUpdated(data: Content[]) { await this.store(data); }
    async flush() { /* nothing to durably flush */ }
    async compact() { return { skipped: 'fake' }; }
    async alreadyStored(items: { sha256: string; url: string }[]) {
        return [...this.rows.entries()]
            .filter(([sha]) => items.some(it => it.sha256 === sha))
            .map(([sha, row]) => ({ sha256: sha, url: row.url }));
    }
    async repointUrls(items: { sha256: string; url: string }[]) {
        items.forEach(it => {
            const row = this.rows.get(it.sha256);
            if (row) row.url = it.url;
        });
    }
}

describe('the language-aware embedding filter (ported from the retired milvus-backed spec)', () => {

    const shared = {
        kafka: { newOpusImportedTopic: 't-imported', opusReimportedTopic: 't-reimported', opusRemovedTopic: 't-removed' },
        milvus: { collection: 'test' },
        paragraph: { minChars: 0, maxChars: 100_000 },
        embedder: { model: 'TEST', dimension: 4 },
    } as unknown as SharedTextbaseConfig;

    const log = { log: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined };

    const URL = (nr: number) => `https://textbase.scriptorium.ro/fake/english_fixture/_${nr}`;

    // Three English paragraphs, mirroring FakeBibliotecaClient's
    // english_fixture ones (the url stays recognizable for the same reason).
    const EN = [
        para('Sentence transformers turn natural language into dense vector embeddings.', 'sha-en1', URL(1), 'en'),
        para('A chapter search returns the paragraphs closest to the query vector.', 'sha-en2', URL(2), 'en'),
        para('The vectorizer only embeds what the encoder can actually understand.', 'sha-en3', URL(3), 'en'),
    ];
    // Twenty real French paragraphs - the count matters: a large-enough
    // page proves the French ones are actively filtered out, not just never
    // reached (same reasoning as the original test).
    const FR = Array.from({ length: 20 }, (_, i) =>
        para(`La sociologie est la science des institutions et de leur genese, paragraphe ${i}.`,
            `sha-fr${i}`, `https://textbase.scriptorium.ro/fake/durkheim/_${i}`, 'fr'));
    // Undetected language: must be skipped exactly like an unsupported one.
    const UNDETECTED = [
        para('a paragraph whose language the server could not detect', 'sha-und', URL(4), undefined),
    ];

    it('embeds only the paragraphs the encoder supports, skipping the rest', async () => {
        const embedder = new EnglishOnlyEmbedder();
        const store = new FakeStore();
        const tbc = new FakeTbc([[...EN, ...FR], UNDETECTED]);

        let interPageCalled = 0;
        const vectorizer = new VectorizerService(
            tbc as unknown as BibliotecaClient,
            embedder as unknown as ContentEmbedder,
            store as unknown as VectorStore,
            shared,
            5); // small page size: several pages through one vectorize() run

        const processed = await vectorizer.vectorize(1, async () => { interPageCalled++; });

        // only the English ones count as processed...
        expect(processed).toEqual(3);
        // ...are embedded...
        expect(embedder.embeddedShas()).toEqual(['sha-en1', 'sha-en2', 'sha-en3']);
        // ...and stored - never the French or undetected ones.
        expect([...store.rows.keys()].sort()).toEqual(['sha-en1', 'sha-en2', 'sha-en3']);
        store.rows.forEach(row => expect(row.url).toContain('english_fixture'));

        expect(interPageCalled).toBeGreaterThan(0);
    });
});
