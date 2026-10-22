/// <reference types="jest" />
import { VectorizerKafkaListenerService } from './kafka/vectorizer-listener.service';
import { KafkaService } from './kafka/kafka.service';
import { BibliotecaClient } from './biblioteca_client.service';
import { VectorizerService } from './vectorizer.service';
import { SharedTextbaseConfig, VectorizerConfiguration } from '../configuration';
import { MemoryVectorStore, VectorStore } from '../ragtime/core';
import { KeywordEmbedder } from '../ragtime/core/test-doubles';
import { BibliotecaVectorCollection } from '../biblioteca-rag/ragtime.providers';
import { TeiElemDto } from '../biblioteca.api';
import { Util } from '../util';

/**
 * "Vectors are precious" policy (a full corpus embed takes days, not an
 * index rebuild): the vectorizer pipeline must REUSE everything the store
 * already holds, keyed by the paragraph's sha256, and must never drop
 * vectors on its own.
 *
 * All mocks, nothing touches a real store/embedder/kafka:
 * - BibliotecaClient hands out a small two-book repo (async pages).
 * - the embedder records every call - the central assertion surface: a
 *   call means "recomputed an embedding", which for an unchanged
 *   paragraph is precisely the wasted work this policy forbids.
 * - ragtime's MemoryVectorStore, with the real retrieve/setPayload
 *   semantics, so the reuse decisions are exercised against lifelike
 *   store behavior; deletes are counted (never expected here).
 *
 * Scenarios (mirroring how the biblio server + nestjs combo sees a repo):
 * 1. a book is renamed (author/work-title: every url changes) and two of
 *    its paragraphs corrected: only the corrected paragraphs get
 *    embedded, the unchanged ones are repointed to their new urls with
 *    their original embeddings, and the sibling book is untouched.
 * 2. a book is removed from the repo: its vectors are RETAINED (removal
 *    is manual-only - POST /api/vector-store/remove-opus).
 */

// A paragraph as textbase-server serves it (GET /api/divs/../paras):
// the sha256 is the paragraph's identity across renames; the url embeds
// the author/work-title, so a rename moves every url of the book.
function para(text: string, sha256: string, url: string): TeiElemDto {
    return { text, text_sha256: sha256, url, language: 'en' } as TeiElemDto;
}

class FakeTbc {
    // Mutable on purpose: the repo's content changes between editions of
    // the same book - the vectorizer/store instances stay the same, only
    // the served pages move, exactly like a real reimport.
    pages: TeiElemDto[][] = [];
    constructor(pages: TeiElemDto[][] = []) { this.pages = pages; }
    // No-op stand-ins: these two just report stats to biblioteca-server,
    // never touched by any assertion in this file.
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

/**
 * The embedder mock: every call is recorded - the assertion surface for
 * "was this paragraph re-embedded (wasted) or reused".
 */
class RecordingEmbedder extends KeywordEmbedder {
    constructor(private readonly shaOf: Map<string, string>) { super(8); }
    embeddedShas(): string[] { return this.embeddedTexts().map(text => this.shaOf.get(text)!); }
}

const URL = (work: string, nr: number) => `https://biblioteca.scriptorium.ro/creanga/${work}/p${nr}`;

// Book A, first edition: four paragraphs.
const A1 = 'once upon a time in the old work, paragraph one stayed exactly the same';
const A2 = 'paragraph two also stayed exactly the same through the rename';
const A3 = 'paragraph three gets corrected in the second edition';
const A4 = 'paragraph four gets corrected in the second edition too';
const BOOK_A_V1 = [
    para(A1, 'sha-a1', URL('amintiri', 1)),
    para(A2, 'sha-a2', URL('amintiri', 2)),
    para(A3, 'sha-a3', URL('amintiri', 3)),
    para(A4, 'sha-a4', URL('amintiri', 4)),
];
// Book A, second edition: renamed (new author/work-title => every url
// changes) and the first two paragraphs corrected (new texts => new shas).
const BOOK_A_V2 = [
    para(A1, 'sha-a1', URL('amintiri-din-copilarie', 1)),                 // renamed only
    para(A2, 'sha-a2', URL('amintiri-din-copilarie', 2)),                 // renamed only
    para(A3 + ' (corrected)', 'sha-a3-v2', URL('amintiri-din-copilarie', 3)), // corrected
    para(A4 + ' (corrected)', 'sha-a4-v2', URL('amintiri-din-copilarie', 4)), // corrected
];
// Book B: the untouched sibling.
const BOOK_B = [
    para('the sibling book keeps its own vectors through everything', 'sha-b1', URL('povesti', 1)),
];
const SHA_OF = new Map([...BOOK_A_V1, ...BOOK_A_V2, ...BOOK_B].map(it => [it.text, it.text_sha256]));
const TEXT_OF = new Map([...SHA_OF.entries()].map(([text, sha]) => [sha, text]));

describe('vector reuse: vectors are precious, never dropped by the pipeline', () => {

    const shared = {
        kafka: { newOpusImportedTopic: 't-imported', opusReimportedTopic: 't-reimported', opusRemovedTopic: 't-removed' },
        milvus: { collection: 'test' },
        paragraph: { minChars: 0, maxChars: 100_000 },
        embedder: { model: 'TEST', dimension: 4 },
    } as unknown as SharedTextbaseConfig;

    const log = { log: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined };

    let embedder: RecordingEmbedder;
    let store: MemoryVectorStore;
    let deletes: jest.SpyInstance;
    let vectorizer: VectorizerService;
    let tbc: FakeTbc;

    // what the store holds for a sha: the url it serves, and the vector of
    // the text it was embedded from (a reused row keeps its original one)
    const row = (sha: string) => {
        const point = store.get('test', sha);
        return point && { url: point.payload.url, vector: point.vector };
    };
    const rowOf = (sha: string, url: string) => ({ url, vector: embedder.vectorOf(TEXT_OF.get(sha)!) });

    const buildVectorizer = (pages: TeiElemDto[][]) => {
        embedder = new RecordingEmbedder(SHA_OF);
        store = new MemoryVectorStore();
        deletes = jest.spyOn(store, 'delete');
        tbc = new FakeTbc(pages);
        vectorizer = new VectorizerService(
            tbc as unknown as BibliotecaClient,
            embedder,
            new BibliotecaVectorCollection(store as VectorStore, null as any, 'test', null as any),
            shared,
            2000);
    };

    it('a renamed book with two corrected paragraphs re-embeds only the corrections', async () => {
        buildVectorizer([BOOK_A_V1]);
        await vectorizer.vectorize(1);
        expect(embedder.embeddedShas().sort()).toEqual(['sha-a1', 'sha-a2', 'sha-a3', 'sha-a4']);
        expect(deletes).toHaveBeenCalledTimes(0);

        // The author renames the work and corrects paragraphs three and
        // four - same vectorizer, same store; only the repo moved.
        tbc.pages = [BOOK_A_V2];
        await vectorizer.vectorize(1);

        // ONLY the two corrected paragraphs cost an embedder call; the
        // two unchanged ones were reused despite every url having moved.
        // (embeddedShas() is cumulative across both vectorize runs -
        // slice off the first run's four.)
        expect(embedder.embeddedShas().slice(4).sort()).toEqual(['sha-a3-v2', 'sha-a4-v2']);

        // Six rows total - nothing dropped, nothing duplicated: the
        // unchanged paragraphs kept their ORIGINAL embeddings and now
        // serve the renamed urls, the corrected ones got new vectors,
        // and the old edition's corrected-away shas are retained (stale
        // rows are the stale-data reporter's business, not the reimport
        // path's - see the last two assertions below).
        expect(await store.count('test')).toBe(6);
        expect(row('sha-a1')).toEqual(rowOf('sha-a1', URL('amintiri-din-copilarie', 1)));
        expect(row('sha-a2')).toEqual(rowOf('sha-a2', URL('amintiri-din-copilarie', 2)));
        expect(row('sha-a3-v2')).toEqual(rowOf('sha-a3-v2', URL('amintiri-din-copilarie', 3)));
        expect(row('sha-a4-v2')).toEqual(rowOf('sha-a4-v2', URL('amintiri-din-copilarie', 4)));
        // The old edition's corrected shas are gone from the page, but
        // their vectors were NOT deleted - retained per policy (stale
        // rows are the stale-data reporter's business, not the
        // reimport path's).
        expect(row('sha-a3')).toEqual(rowOf('sha-a3', URL('amintiri', 3)));
        expect(row('sha-a4')).toEqual(rowOf('sha-a4', URL('amintiri', 4)));
        expect(deletes).toHaveBeenCalledTimes(0);
    });

    it('the sibling book is never touched by another book reimport', async () => {
        buildVectorizer([BOOK_A_V1, BOOK_B]);
        await vectorizer.vectorize(1);
        await vectorizer.vectorize(2);

        tbc.pages = [BOOK_A_V2, BOOK_B];
        await vectorizer.vectorize(1);

        // Book B: same single embedding, same url - untouched.
        expect(embedder.embeddedShas().filter(sha => sha.startsWith('sha-b')).length).toBe(1);
        expect(row('sha-b1')).toEqual(rowOf('sha-b1', URL('povesti', 1)));
    });

    it('a book removed from the repo RETAINS its vectors (removal is manual-only)', async () => {
        // Real VectorizerKafkaListenerService over the real VectorizerService and
        // the fake store: the removal event flows through the exact
        // production decision path.
        buildVectorizer([BOOK_A_V1]);
        const listenerTbc = {
            getParagraphs: (id: number, size: number) => tbc.getParagraphs(id, size),
            getElemByPath: async (path: string) => ({ id: 1, path }),
        } as unknown as BibliotecaClient;

        const delaySpy = jest.spyOn(Util, 'delay').mockResolvedValue(undefined);

        let eachMessage: (payload: any) => Promise<void> = () => Promise.resolve();
        const consumer: any = {
            connect: jest.fn().mockResolvedValue(undefined),
            subscribe: jest.fn().mockResolvedValue(undefined),
            run: jest.fn().mockImplementation(({ eachMessage: h }) => { eachMessage = h; }),
        };
        const ks = { kafka: { consumer: jest.fn(() => consumer) }, ensureTopics: jest.fn().mockResolvedValue(undefined) } as unknown as KafkaService;

        const listener = new VectorizerKafkaListenerService(
            ks, listenerTbc, vectorizer,
            { kafkaGroupId: 'test-group' } as unknown as VectorizerConfiguration,
            shared);
        await listener.initKafkaListener();

        const heartbeat = jest.fn().mockResolvedValue(undefined);
        const event = (topic: string, path: string) =>
            eachMessage({ topic, message: { value: Buffer.from(JSON.stringify({ path })) }, heartbeat });

        // First the book is imported - vectors stored.
        await event('t-imported', 'creanga/amintiri');
        expect(await store.count('test')).toBe(4);

        // Then the book vanishes from the repo - its vectors must STAY.
        await event('t-removed', 'creanga/amintiri');
        expect(await store.count('test')).toBe(4);
        expect(deletes).toHaveBeenCalledTimes(0);
        expect(row('sha-a1')).toEqual(rowOf('sha-a1', URL('amintiri', 1)));
        delaySpy.mockRestore();
    });
});
