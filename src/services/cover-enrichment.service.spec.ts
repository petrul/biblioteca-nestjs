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
});
