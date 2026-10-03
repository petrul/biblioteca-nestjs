import { EnrichmentService } from './enrichment.service';

/**
 * The enrichment worker, moved from biblioteca-server's Java
 * EnrichmentService, owns all the external calls (Wikipedia summary API,
 * Wikidata facts) and writes the result to biblioteca-server's narrow
 * idempotent persistence endpoint.
 *
 * The assertions that matter most here:
 * - "vectors are precious": every network call the service makes goes to
 *   wikipedia.org / wikidata.org or the enrichment persistence endpoint -
 *   structurally it cannot drop, truncate or even reach a vector store.
 * - idempotency: authors with a bio and opera with a summary are skipped
 *   without any network call at all.
 * - best-effort: a failed lookup leaves the entity alone instead of
 *   aborting the sweep.
 *
 * All fetches are stubbed, nothing leaves this process.
 */

const AUTHOR_WIKIBASE = 'Q123';

function wikiSummaryPage(overrides: Record<string, unknown> = {}) {
  return {
    extract: 'Vasile Alecsandri was a Romanian poet and playwright.',
    originalimage: { source: 'https://upload.wikimedia.org/alecsandri.jpg' },
    wikibase_item: AUTHOR_WIKIBASE,
    ...overrides,
  };
}

function timeClaim(time: string, precision: number) {
  return { mainsnak: { datavalue: { value: { time, precision } } } };
}

function idClaim(id: string) {
  return { mainsnak: { datavalue: { value: { id } } } };
}

function stringClaim(value: string) {
  return { mainsnak: { datavalue: { value } } };
}

/** The canned Wikidata world: one author entity with facts to harvest. */
const WIKIDATA = {
  [AUTHOR_WIKIBASE]: {
    claims: {
      P569: [timeClaim('+1850-01-15T00:00:00Z', 11)],
      P570: [timeClaim('+1899-01-01T00:00:00Z', 9)],
      P19: [idClaim('Q4918')],
      P27: [idClaim('Q217')],
      P1412: [idClaim('Q7918')],
      // P18 (image): Commons file titles, same shape the real entities
      // carry - the service turns them into Special:FilePath URLs.
      P18: [stringClaim('Vasile Alecsandri.jpg'), stringClaim('File:Alecsandri 1865.jpg')],
    },
  },
  Q4918: { claims: {} },
  Q217: { claims: {} },
  Q7918: { claims: { P218: [stringClaim('ro')] } },
  Q1860: { claims: { P218: [stringClaim('en')] } },
};

const LABELS = {
  Q4918: { labels: { en: { value: 'Bacău' } } },
  Q217: { labels: { en: { value: 'Romania' } } },
  Q7918: { labels: { en: { value: 'Romanian language' } } },
};

class FakeFetch {
  calls: { url: string; init?: RequestInit }[] = [];
  pages: Record<string, any> = {};

  stub = async (url: any, init?: any) => {
    this.calls.push({ url: String(url), init });
    if (url.startsWith('https://en.wikipedia.org/api/rest_v1/')) {
      return { ok: true, json: async () => this.pages['wiki'] ?? null };
    }
    const entity = url.match(/Special:EntityData\/(Q\d+)\.json/);
    if (entity) {
      return { ok: true, json: async () => ({ entities: { [entity[1]]: WIKIDATA[entity[1]] } }) };
    }
    if (url.startsWith('https://www.wikidata.org/w/api.php')) {
      const ids = decodeURIComponent(url.split('ids=')[1]).split('|');
      return { ok: true, json: async () => ({ entities: Object.fromEntries(ids.map((id: string) => [id, LABELS[id] ?? {}])) }) };
    }
    if (url.includes('/api/internal/enrichment')) {
      return { ok: true, json: async () => ({ updated: true }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  persisted(): any[] {
    return this.calls.filter(c => c.url.includes('/api/internal/enrichment'))
      .map(c => JSON.parse(String(c.init!.body)));
  }
}

class FakeTbc {
  authors: any[] = [];
  opera: any[] = [];
  async getAuthors() { return this.authors; }
  async getAllOpera() { return this.opera; }
  // dailySweep() paginates through allOperaGen() now (no more fixed
  // page-size cap) - the fake doesn't need real pagination, just to
  // satisfy the same shape by yielding everything in one go.
  async *allOperaGen() { for (const opus of this.opera) yield opus; }
}

function service(tbc: FakeTbc, fetch: FakeFetch, covers?: any) {
  (global as any).fetch = fetch.stub;
  const conf = { bibliotecaUrl: 'http://biblioteca.test' } as any;
  return new EnrichmentService(tbc as any, conf, covers);
}

describe('EnrichmentService', () => {
  let originalFetch: any;
  beforeAll(() => { originalFetch = (global as any).fetch; });
  afterAll(() => { (global as any).fetch = originalFetch; });

  it('skips authors with a bio and opera with a description - no call at all', async () => {
    const tbc = new FakeTbc();
    tbc.authors = [{ strId: 'alecsandri', displayName: 'Vasile Alecsandri', bio: 'already there' }];
    tbc.opera = [{ id: 7, head: 'Lume', description: 'already there' }];
    const fetchMock = new FakeFetch();
    await service(tbc, fetchMock).dailySweep();
    expect(fetchMock.calls).toHaveLength(0);
  });

  it('enriches an author with the Wikipedia extract, Wikidata facts and lead image', async () => {
    const tbc = new FakeTbc();
    tbc.authors = [{ strId: 'alecsandri', displayName: 'Vasile Alecsandri' }];
    const fetchMock = new FakeFetch();
    fetchMock.pages['wiki'] = wikiSummaryPage();
    await service(tbc, fetchMock).dailySweep();

    const persisted = fetchMock.persisted();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      authorStrId: 'alecsandri',
      bio: 'Vasile Alecsandri was a Romanian poet and playwright.',
      bioSourceUrl: 'https://en.wikipedia.org/wiki/Vasile_Alecsandri',
      birthDate: '1850-01-15',
      deathDate: '1899', // precision 9: the year is all the claim asserts
      birthPlace: 'Bacău',
      country: 'Romania',
      writingLanguage: 'RO', // P1412 -> Q7918 -> P218 'ro'
      // the lead image first, then the Wikidata entity's P18 Commons art
      imageUrls: [
        'https://upload.wikimedia.org/alecsandri.jpg',
        'https://commons.wikimedia.org/wiki/Special:FilePath/Vasile_Alecsandri.jpg?width=1200',
        'https://commons.wikimedia.org/wiki/Special:FilePath/Alecsandri_1865.jpg?width=1200',
      ],
    });
  });

  it('enriches an opus with the article lead image plus the work entity\'s Commons art', async () => {
    const tbc = new FakeTbc();
    tbc.opera = [{ id: 7, head: 'Lume Rdicată' }];
    const fetchMock = new FakeFetch();
    // wikibase_item present -> the work's own Wikidata entity is
    // consulted for P18 art, same as the author's is for its facts.
    fetchMock.pages['wiki'] = wikiSummaryPage();
    await service(tbc, fetchMock).dailySweep();

    const persisted = fetchMock.persisted();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      opusId: 7,
      imageUrls: [
        'https://upload.wikimedia.org/alecsandri.jpg',
        'https://commons.wikimedia.org/wiki/Special:FilePath/Vasile_Alecsandri.jpg?width=1200',
        'https://commons.wikimedia.org/wiki/Special:FilePath/Alecsandri_1865.jpg?width=1200',
      ],
    });
  });

  it('enriches an opus with the Wikipedia extract and image', async () => {
    const tbc = new FakeTbc();
    tbc.opera = [{ id: 7, head: 'Lume Rdicată' }];
    const fetchMock = new FakeFetch();
    fetchMock.pages['wiki'] = wikiSummaryPage({ wikibase_item: undefined });
    await service(tbc, fetchMock).dailySweep();

    const persisted = fetchMock.persisted();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      opusId: 7,
      summary: 'Vasile Alecsandri was a Romanian poet and playwright.',
      imageUrls: ['https://upload.wikimedia.org/alecsandri.jpg'],
    });
    // no wikibase_item -> no Wikidata round-trips at all
    expect(fetchMock.calls.filter(c => c.url.includes('wikidata.org'))).toHaveLength(0);
  });

  it('truncates long material at the last sentence boundary', async () => {
    const tbc = new FakeTbc();
    tbc.opera = [{ id: 7, head: 'Lume' }];
    const fetchMock = new FakeFetch();
    fetchMock.pages['wiki'] = wikiSummaryPage({
      extract: `${'A very long sentence about the opus that goes on and on. '.repeat(30)}One final sentence ends here. Trailing text that must be cut off entirely because it is past the limit.`,
    });
    await service(tbc, fetchMock).dailySweep();

    const summary = fetchMock.persisted()[0].summary as string;
    expect(summary.length).toBeLessThanOrEqual(1200);
    expect(summary.endsWith('.')).toBe(true);
    expect(summary).not.toContain('Trailing text');
  });

  it('leaves an entity alone when Wikipedia has no extract', async () => {
    const tbc = new FakeTbc();
    tbc.authors = [{ strId: 'nimeni', displayName: 'Nimeni Altu' }];
    tbc.opera = [{ id: 9, head: 'Anonim' }];
    const fetchMock = new FakeFetch();
    fetchMock.pages['wiki'] = {}; // 200 OK but no extract
    await expect(service(tbc, fetchMock).dailySweep()).resolves.toBeUndefined();
    expect(fetchMock.persisted()).toHaveLength(0);
  });

  it('skips an already-enriched author when called directly without force - no call at all', async () => {
    const tbc = new FakeTbc();
    const author = { strId: 'alecsandri', displayName: 'Vasile Alecsandri', bio: 'old bio' };
    const fetchMock = new FakeFetch();
    await service(tbc, fetchMock).enrichAuthor(author);
    expect(fetchMock.calls).toHaveLength(0);
  });

  it('force re-enriches an already-enriched author and asks the server to overwrite', async () => {
    const tbc = new FakeTbc();
    const author = { strId: 'alecsandri', displayName: 'Vasile Alecsandri', bio: 'old bio' };
    const fetchMock = new FakeFetch();
    fetchMock.pages['wiki'] = wikiSummaryPage();
    await service(tbc, fetchMock).enrichAuthor(author, { force: true });

    const persisted = fetchMock.persisted();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ authorStrId: 'alecsandri', overwrite: true });
  });

  it('force re-enriches an already-enriched work too', async () => {
    const tbc = new FakeTbc();
    const opus = { id: 7, head: 'Lume', description: 'old summary' };
    const fetchMock = new FakeFetch();
    fetchMock.pages['wiki'] = wikiSummaryPage({ wikibase_item: undefined });
    await service(tbc, fetchMock).enrichWork(opus, { force: true });

    const persisted = fetchMock.persisted();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ opusId: 7, overwrite: true });
  });

  it('fill-only persistence carries an explicit overwrite: false, so the server rule is unambiguous', async () => {
    const tbc = new FakeTbc();
    tbc.authors = [{ strId: 'alecsandri', displayName: 'Vasile Alecsandri' }];
    const fetchMock = new FakeFetch();
    fetchMock.pages['wiki'] = wikiSummaryPage();
    await service(tbc, fetchMock).dailySweep();

    expect(fetchMock.persisted()[0].overwrite).toBe(false);
  });

  it('orders covers only after the graphics are retrieved, work art first, author portrait as the fallback', async () => {
    const tbc = new FakeTbc();
    tbc.authors = [{ strId: 'alecsandri', displayName: 'Vasile Alecsandri' }];
    tbc.opera = [
      // enriched by this sweep -> cover ordered with the work's own art
      { id: 7, head: 'Lume Rdicată', completePath: 'alecsandri/lume', author: { strId: 'alecsandri', displayName: 'Vasile Alecsandri' } },
      // already enriched -> cover ordered with the author portrait instead
      { id: 8, head: 'Desteptarea', completePath: 'alecsandri/desteptarea', description: 'already there', author: { strId: 'alecsandri', displayName: 'Vasile Alecsandri' } },
    ];
    const fetchMock = new FakeFetch();
    fetchMock.pages['wiki'] = wikiSummaryPage();
    const enqueued: any[] = [];
    const order: string[] = [];
    const covers = { enqueue: (candidate: any) => { enqueued.push(candidate); order.push('cover'); } };
    // one shared sequence to prove the ordering: the enrichment persistence
    // precedes the cover order for the same opus, never the other way around.
    const realStub = fetchMock.stub;
    fetchMock.stub = async (url: any, init?: any) => {
      if (String(url).includes('/api/internal/enrichment')) order.push('enrich');
      return realStub(url, init);
    };
    await service(tbc, fetchMock, covers).dailySweep();

    expect(enqueued).toHaveLength(2);
    expect(enqueued[0]).toMatchObject({ id: 7, artUrl: 'https://upload.wikimedia.org/alecsandri.jpg' });
    expect(enqueued[1]).toMatchObject({ id: 8, artUrl: 'https://upload.wikimedia.org/alecsandri.jpg' });
    // author enrich, work enrich, then the two cover orders - enrichment always first
    expect(order).toEqual(['enrich', 'enrich', 'cover', 'cover']);
  });

  it('never talks to anything but wikipedia, wikidata and the enrichment endpoint', async () => {
    const tbc = new FakeTbc();
    tbc.authors = [{ strId: 'alecsandri', displayName: 'Vasile Alecsandri' }];
    tbc.opera = [{ id: 7, head: 'Lume' }];
    const fetchMock = new FakeFetch();
    fetchMock.pages['wiki'] = wikiSummaryPage();
    await service(tbc, fetchMock).dailySweep();

    // every https call goes to wikipedia/wikidata; the only other calls
    // are the persistence POSTs to the biblioteca-server enrichment
    // endpoint - no vector store, no deletes, no admin surface
    for (const call of fetchMock.calls.filter(c => c.url.startsWith('https://'))) {
      expect(call.url).toMatch(/^https:\/\/(en\.wikipedia\.org|www\.wikidata\.org)\//);
    }
    const serverCalls = fetchMock.calls.filter(c => !c.url.startsWith('https://'));
    expect(serverCalls).toHaveLength(2);
    for (const call of serverCalls) {
      expect(call.url).toBe('http://biblioteca.test/api/internal/enrichment');
      expect(call.init?.method).toBe('POST');
    }
  });
});
