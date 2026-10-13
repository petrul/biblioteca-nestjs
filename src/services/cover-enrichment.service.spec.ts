/// <reference types="jest" />
import { CoverEnrichmentService } from './cover-enrichment.service';

/**
 * Only the enqueue admission rule matters here - the fill-only invariant
 * and its one explicit bypass:
 *
 * - an opus that already has a coverUrl is never re-rendered by default;
 * - force (the manual admin runs' overwrite switch) is the only way past
 *   that;
 * - the same path is deduplicated while a render is in flight, even with
 *   force;
 * - without MinIO credentials the service is disabled and enqueues nothing.
 *
 * Generation itself is faked: the cover renderer fetch is stubbed to fail
 * fast, which generate() swallows (best-effort by design), so no network
 * and no MinIO client call happens. What is counted is how often a
 * generation was actually attempted.
 */

function makeService(conf: Record<string, any> = {}) {
  return new CoverEnrichmentService({} as any, {
    minioUrl: 'http://minio.test',
    minioCred: 'key:secret',
    coversApiUrl: 'http://covers.test',
    ...conf,
  } as any);
}

async function settle(svc: CoverEnrichmentService) {
  for (let i = 0; i < 100 && ((svc as any).active > 0 || (svc as any).queue.length > 0); i++) {
    await new Promise(r => setImmediate(r));
  }
}

describe('CoverEnrichmentService enqueue admission', () => {
  let originalFetch: any;
  let renderAttempts: string[];
  let renderBodies: any[];
  beforeAll(() => {
    originalFetch = (global as any).fetch;
    renderAttempts = [];
    renderBodies = [];
    (global as any).fetch = (async (url: any, init?: any) => {
      // /api/cover/meta is randomTheme()'s discovery probe (see the
      // service), not a render attempt - keep it out of renderAttempts.
      if (String(url).endsWith('/api/cover/meta')) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      renderAttempts.push(String(url));
      if (init?.body) renderBodies.push(JSON.parse(String(init.body)));
      return { ok: false, status: 500, json: async () => ({}) };
    }) as any;
  });
  afterAll(() => { (global as any).fetch = originalFetch; });
  beforeEach(() => { renderAttempts.length = 0; renderBodies.length = 0; });

  it('skips an opus that already has a cover - fill-only by default', async () => {
    const svc = makeService();
    svc.enqueue({ id: 1, path: 'p1', title: 'T', author: 'A', coverUrl: 'https://x/c.png' });
    await settle(svc);
    expect(renderAttempts).toHaveLength(0);
  });

  it('force re-renders an opus that already has a cover', async () => {
    const svc = makeService();
    svc.enqueue({ id: 1, path: 'p1', title: 'T', author: 'A', coverUrl: 'https://x/c.png' }, { force: true });
    await settle(svc);
    expect(renderAttempts).toEqual(['http://covers.test/api/cover']);
  });

  it('dedupes the same path while it is in flight, even with force', async () => {
    const svc = makeService();
    svc.enqueue({ id: 1, path: 'p1', title: 'T', author: 'A' });
    svc.enqueue({ id: 1, path: 'p1', title: 'T', author: 'A' }, { force: true });
    await settle(svc);
    expect(renderAttempts).toEqual(['http://covers.test/api/cover']);
  });

  it('enqueues nothing at all when the MinIO cache is not configured', async () => {
    const svc = makeService({ minioUrl: undefined, minioCred: undefined });
    svc.enqueue({ id: 1, path: 'p1', title: 'T', author: 'A' });
    svc.enqueue({ id: 1, path: 'p1', title: 'T', author: 'A', artUrl: 'https://upload.wikimedia.org/a.jpg' }, { force: true });
    await settle(svc);
    expect(renderAttempts).toHaveLength(0);
  });

  it('sends the retrieved art as the renderer coverArtUrl, and omits it when absent', async () => {
    const svc = makeService();
    svc.enqueue({ id: 1, path: 'p1', title: 'T', author: 'A', artUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Some_Art.jpg?width=1200' });
    svc.enqueue({ id: 2, path: 'p2', title: 'T2', author: 'A2' });
    await settle(svc);
    expect(renderBodies).toHaveLength(2);
    expect(renderBodies[0].coverArtUrl).toBe('https://commons.wikimedia.org/wiki/Special:FilePath/Some_Art.jpg?width=1200');
    expect(renderBodies[1].coverArtUrl).toBeUndefined();
  });

  it('prints the Ediții Scriptorium imprint (publisher, 2026, București, Scriptorium Classique), and logs the exact JSON it sends', async () => {
    const svc = makeService();
    const logged: string[] = [];
    jest.spyOn((svc as any).log, 'log').mockImplementation((message: any) => { logged.push(String(message)); });
    svc.enqueue({ id: 1, path: 'eminescu/poezii', title: 'Poezii', author: 'Mihai Eminescu' });
    await settle(svc);
    expect(renderBodies).toHaveLength(1);
    expect(renderBodies[0]).toMatchObject({
      title: 'Poezii', author: 'Mihai Eminescu',
      publisher: 'Ediții Scriptorium', date: '2026', pubPlace: 'București', series: 'Scriptorium Classique',
    });
    const line = logged.find(m => m.startsWith('cover request eminescu/poezii: '));
    expect(line).toBeDefined();
    expect(JSON.parse(line!.slice('cover request eminescu/poezii: '.length))).toEqual(renderBodies[0]);
  });
});

/**
 * The storage half of generate(): a successful render must land the PNG
 * in the MinIO cover cache and only then report the public object URL
 * back to the server (persistEnrichment) - the coverUrl the reader and
 * the REST API then serve. Everything external is faked: the renderer
 * fetch returns a fixed PNG buffer, and putObject is a jest mock on the
 * real MinioClient instance, so no network and no MinIO server.
 */
describe('CoverEnrichmentService stores the rendered cover in MinIO', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  let originalFetch: any;
  let renderCalls: any[] = [];
  let persisted: any[] = [];

  class FakeBiblioteca {
    async persistEnrichment(update: any) { persisted.push(update); }
  }

  beforeAll(() => {
    originalFetch = (global as any).fetch;
    (global as any).fetch = (async (_url: any, init?: any) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
      headers: new Map(),
    })) as any;
  });
  afterAll(() => { (global as any).fetch = originalFetch; });
  beforeEach(() => { renderCalls = []; persisted = []; });

  function makeStoredService() {
    const conf = {
      minioUrl: 'http://minio.test',
      minioCred: 'key:secret',
      coversApiUrl: 'http://covers.test',
    } as any;
    const svc = new CoverEnrichmentService(new FakeBiblioteca() as any, conf);
    const putObject = jest.spyOn((svc as any).minio!, 'putObject').mockImplementation(async (...args: any[]) => {
      renderCalls.push(args);
      return { etag: 'mock' };
    });
    return { svc, putObject };
  }

  it('puts the rendered PNG in the cover cache and persists the public URL', async () => {
    const { svc, putObject } = makeStoredService();
    svc.enqueue({ id: 7, path: 'opera/alecsandri/lume-ridicata.xml', title: 'Lume', author: 'Vasile Alecsandri' });
    await settle(svc);

    // stored in MinIO: bucket biblioteca, the covers/ key carries the opus
    // path for readability but is hashed from the rendered BYTES (not the
    // path) so a re-render always lands at a new URL - see objectKey's own
    // comment for why that matters regardless of the cache lifetime below.
    // Two objects: the PNG, then the request JSON it was rendered from.
    expect(putObject).toHaveBeenCalledTimes(2);
    const [bucket, key, body, size, headers] = renderCalls[0];
    expect(bucket).toBe('biblioteca');
    expect(key).toBe('covers/opera/alecsandri/lume-ridicata.xml-4353a1de7e0d.png');
    expect(Buffer.from(body)).toEqual(PNG);
    expect(size).toBe(PNG.length);
    expect(headers).toMatchObject({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
    const [, requestKey, requestBody] = renderCalls[1];
    expect(requestKey).toBe('covers/opera/alecsandri/lume-ridicata.xml-4353a1de7e0d.json');
    expect(JSON.parse(Buffer.from(requestBody).toString('utf8'))).toMatchObject({
      title: 'Lume', author: 'Vasile Alecsandri', publisher: 'Ediții Scriptorium', series: 'Scriptorium Classique',
    });

    // and only then reported to the server, as the public MinIO URL
    expect(persisted).toEqual([
      { opusId: 7, coverUrl: `http://minio.test/${key}` },
    ]);
  });

  it('a failed render stores nothing and reports nothing', async () => {
    const { svc, putObject } = makeStoredService();
    (global as any).fetch = (async () => ({ ok: false, status: 500 })) as any;
    try {
      svc.enqueue({ id: 8, path: 'p-fail', title: 'T', author: 'A' });
      await settle(svc);
    } finally {
      (global as any).fetch = (async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
      })) as any;
    }
    expect(putObject).not.toHaveBeenCalled();
    expect(persisted).toHaveLength(0);
  });

  it('re-renders a cover whose stored object was deleted from MinIO', async () => {
    const { svc, putObject } = makeStoredService();
    const getPartialObject = jest.spyOn((svc as any).minio!, 'getPartialObject')
      .mockRejectedValue(Object.assign(new Error('Not Found'), { code: 'NotFound' }));
    const coverUrl = 'http://minio.test/covers/dostoyevskii/bratya_karamazovy-c510c48cd6d9.png';

    const done = svc.enqueue({ id: 9, path: 'dostoyevskii/bratya_karamazovy', title: 'T', author: 'A', coverUrl });

    await expect(done).resolves.toBe(true);
    expect(getPartialObject).toHaveBeenCalledWith('biblioteca', 'covers/dostoyevskii/bratya_karamazovy-c510c48cd6d9.png', 0, 12);
    expect(putObject).toHaveBeenCalledTimes(2); // PNG + request JSON
  });

  it('leaves a cover alone while its stored object still exists and carries image bytes', async () => {
    const { svc, putObject } = makeStoredService();
    jest.spyOn((svc as any).minio!, 'getPartialObject')
      .mockResolvedValue((async function* () { yield Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); })() as any);

    const done = svc.enqueue({ id: 9, path: 'p9', title: 'T', author: 'A', coverUrl: 'http://minio.test/covers/p9-abc.png' });

    await expect(done).resolves.toBe(false);
    expect(putObject).not.toHaveBeenCalled();
  });
});

describe('CoverEnrichmentService randomTheme layout exclusion', () => {
  let originalFetch: any;
  beforeAll(() => {
    originalFetch = (global as any).fetch;
  });
  afterAll(() => { (global as any).fetch = originalFetch; });

  it('never picks storybook_whimsy even though the covers service still offers it', async () => {
    (global as any).fetch = (async (url: any) => {
      if (String(url).endsWith('/api/cover/meta')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            layouts: [{ id: 'storybook_whimsy' }, { id: 'archival_monograph' }, { id: 'constructivist' }],
            palettes: [{ id: 'archival_alabaster' }],
          }),
        };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    }) as any;

    const svc = makeService();
    const picks = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const theme = await (svc as any).randomTheme();
      picks.add(theme.layout);
    }

    expect(picks.has('storybook_whimsy')).toBe(false);
    // The pool isn't just accidentally empty - the other two still get picked.
    expect(picks.has('archival_monograph') || picks.has('constructivist')).toBe(true);
  });
});

/**
 * The admin path: generateNow renders synchronously and replaces the work's
 * cover; storedRequest reads back the JSON a cover was rendered from.
 */
describe('CoverEnrichmentService on-demand cover and its stored request', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let persisted: any[];
  let stored: Map<string, Buffer>;
  let originalFetch: any;

  function makeService() {
    persisted = [];
    stored = new Map();
    const svc = new CoverEnrichmentService({ async persistEnrichment(update: any) { persisted.push(update); } } as any, {
      minioUrl: 'http://minio.test', minioCred: 'key:secret', coversApiUrl: 'http://covers.test',
    } as any);
    jest.spyOn((svc as any).minio!, 'putObject').mockImplementation(async (_b: any, key: any, body: any) => { stored.set(key, Buffer.from(body)); return {} as any; });
    jest.spyOn((svc as any).minio!, 'getObject').mockImplementation(async (_b: any, key: any) => {
      if (!stored.has(key)) throw Object.assign(new Error('missing'), { code: 'NoSuchKey' });
      return (async function* () { yield stored.get(key)!; })() as any;
    });
    return svc;
  }

  beforeAll(() => {
    originalFetch = (global as any).fetch;
    (global as any).fetch = (async (url: any) => String(url).endsWith('/api/cover/meta')
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, status: 200, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length) }) as any;
  });
  afterAll(() => { (global as any).fetch = originalFetch; });

  it('generateNow replaces the current cover and returns the new URL with its request JSON, which storedRequest reads back', async () => {
    const svc = makeService();
    const result = await svc.generateNow({ id: 5, path: 'eminescu/poezii', title: 'Poezii', author: 'Mihai Eminescu', coverUrl: 'http://minio.test/covers/eminescu/poezii-old.png' });
    expect(result.coverUrl).toMatch(/^http:\/\/minio\.test\/covers\/eminescu\/poezii-[0-9a-f]{12}\.png$/);
    expect(result.request).toMatchObject({ title: 'Poezii', publisher: 'Ediții Scriptorium', date: '2026', pubPlace: 'București', series: 'Scriptorium Classique' });
    expect(persisted).toEqual([{ opusId: 5, coverUrl: result.coverUrl, replaceCover: true }]);
    expect(await svc.storedRequest(result.coverUrl)).toEqual(result.request);
  });

  it('storedRequest is null for covers rendered before requests were recorded, and for foreign URLs', async () => {
    const svc = makeService();
    expect(await svc.storedRequest('http://minio.test/covers/old/work-0123456789ab.png')).toBeNull();
    expect(await svc.storedRequest('https://upload.wikimedia.org/some.jpg')).toBeNull();
    expect(await svc.storedRequest(undefined)).toBeNull();
  });

  it('routine (queued) renders only fill the cover - no replaceCover', async () => {
    const svc = makeService();
    await svc.enqueue({ id: 6, path: 'cehov/teatru', title: 'Teatru', author: 'Cehov' });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].replaceCover).toBeUndefined();
  });
});


/**
 * The database's coverUrl is a claim, not a fact: the MinIO object behind
 * it must exist AND carry image bytes. JSON error bodies stored under .png
 * keys by a misbehaving renderer and objects deleted behind the database's
 * back both count as "no cover" - callers that skip generation on coverUrl
 * alone (Kafka listener, manual admin run) ask hasUsableCover instead of
 * trusting the database field.
 */
describe('stored cover verification (hasUsableCover)', () => {
  const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const JSON_HEAD = Buffer.from('{"status":"ok","book":{');

  function makeVerifyingService(objects: Record<string, Buffer | Error>) {
    const svc = new CoverEnrichmentService({ async persistEnrichment(_update: any) { /* recorded by callers that care */ } } as any, {
      minioUrl: 'http://minio.test',
      minioCred: 'key:secret',
      coversApiUrl: 'http://covers.test',
    } as any);
    jest.spyOn((svc as any).minio!, 'getPartialObject').mockImplementation(async (_b: any, key: any) => {
      const value = objects[key];
      if (!value) throw Object.assign(new Error('missing'), { code: 'NoSuchKey' });
      if (value instanceof Error) throw value;
      const body = value;
      return (async function* () { yield body; })() as any;
    });
    return svc;
  }

  it('accepts a stored object that exists and carries image bytes (PNG and JPEG signatures)', async () => {
    const svc = makeVerifyingService({ 'covers/a/png-1.png': PNG_HEAD, 'covers/a/jpg-1.png': JPEG_HEAD });
    expect(await svc.hasUsableCover('http://minio.test/covers/a/png-1.png')).toBe(true);
    expect(await svc.hasUsableCover('http://minio.test/covers/a/jpg-1.png')).toBe(true);
  });

  it('rejects a stored object that holds a JSON body instead of an image', async () => {
    const svc = makeVerifyingService({ 'covers/a/b-1.png': JSON_HEAD });
    expect(await svc.hasUsableCover('http://minio.test/covers/a/b-1.png')).toBe(false);
  });

  it('rejects a stored object that is missing from the bucket', async () => {
    const svc = makeVerifyingService({});
    expect(await svc.hasUsableCover('http://minio.test/covers/a/gone-1.png')).toBe(false);
  });

  it('trusts the stored URL when MinIO itself cannot answer', async () => {
    const svc = makeVerifyingService({ 'covers/a/err-1.png': Object.assign(new Error('socket hang up'), { code: 'Unknown' }) });
    expect(await svc.hasUsableCover('http://minio.test/covers/a/err-1.png')).toBe(true);
  });

  it('treats no stored URL as unusable and foreign URLs as trusted', async () => {
    const svc = makeVerifyingService({});
    expect(await svc.hasUsableCover(undefined)).toBe(false);
    expect(await svc.hasUsableCover('https://upload.wikimedia.org/some.jpg')).toBe(true);
  });

  it('trusts every stored URL when the MinIO cover cache is not configured', async () => {
    const svc = new CoverEnrichmentService({} as any, { coversApiUrl: 'http://covers.test' } as any);
    expect(await svc.hasUsableCover('https://anything.example/c.png')).toBe(true);
    expect(await svc.hasUsableCover(undefined)).toBe(false);
  });

  it('a poisoned stored cover lets enqueue through to a re-render', async () => {
    const svc = makeVerifyingService({ 'covers/a/b-1.png': JSON_HEAD });
    const putObject = jest.spyOn((svc as any).minio!, 'putObject').mockImplementation(async () => ({}) as any);
    const originalFetch = (global as any).fetch;
    let renders = 0;
    (global as any).fetch = (async (url: any) => String(url).endsWith('/api/cover/meta')
      ? { ok: false, status: 500, json: async () => ({}) }
      : (renders++, { ok: true, status: 200, arrayBuffer: async () => PNG_HEAD.buffer.slice(PNG_HEAD.byteOffset, PNG_HEAD.byteOffset + PNG_HEAD.length) })) as any;
    try {
      const done = svc.enqueue({ id: 3, path: 'a/b', title: 'T', author: 'A', coverUrl: 'http://minio.test/covers/a/b-1.png' });
      await expect(done).resolves.toBe(true);
    } finally {
      (global as any).fetch = originalFetch;
    }
    expect(renders).toBe(1);
    expect(putObject).toHaveBeenCalled();
  });
});
