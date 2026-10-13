/// <reference types="jest" />
import { WorkEnrichmentKafkaListenerService } from './work-enrichment-listener.service';
import { CoverEnrichmentService } from '../cover-enrichment.service';

/**
 * enrichWorkTopic requests (published by biblioteca-server when it serves a
 * work without a cover) turn into a random cover - and only for works that
 * still lack one. Kafka itself is not involved: handleEnrichWork is what
 * each message runs.
 */
function makeListener(opus: any, author: any = { imageUrls: [], image_href: null }) {
  const enqueued: any[] = [];
  const tbc = {
    getElemByPath: jest.fn(async (path: string) => {
      if (opus instanceof Error) throw opus;
      return { ...opus, path };
    }),
    getAuthor: jest.fn(async () => author),
  };
  const covers = {
    enqueue: jest.fn(async (candidate: any) => { enqueued.push(candidate); return true; }),
    hasUsableCover: jest.fn(async (_coverUrl?: string) => true),
  };
  const listener = new WorkEnrichmentKafkaListenerService({} as any, tbc as any, covers as any, { kafka: {} } as any);
  return { listener, tbc, covers, enqueued };
}

describe('WorkEnrichmentKafkaListenerService', () => {
  const work = { id: 7, head: 'Poezii', author: { strId: 'eminescu', displayName: 'Mihai Eminescu' } };

  it('enqueues a cover for a work without one, with one of its author\'s images as art', async () => {
    const { listener, covers, enqueued } = makeListener(work, { imageUrls: ['https://img/a.jpg'], image_href: 'https://img/b.jpg' });
    expect(await listener.handleEnrichWork('eminescu/poezii')).toBe(true);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ id: 7, path: 'eminescu/poezii', title: 'Poezii', author: 'Mihai Eminescu' });
    expect(['https://img/a.jpg', 'https://img/b.jpg']).toContain(enqueued[0].artUrl);
    expect(covers.hasUsableCover).not.toHaveBeenCalled();
  });

  it('re-orders a cover when the stored one fails MinIO verification, keeping the old URL on the candidate', async () => {
    const { listener, covers, enqueued } = makeListener({ ...work, coverUrl: 'https://test.scriptorium.ro/biblioteca/covers/x.png' });
    covers.hasUsableCover.mockResolvedValue(false);
    expect(await listener.handleEnrichWork('eminescu/poezii')).toBe(true);
    expect(covers.hasUsableCover).toHaveBeenCalledWith('https://test.scriptorium.ro/biblioteca/covers/x.png');
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ id: 7, path: 'eminescu/poezii', coverUrl: 'https://test.scriptorium.ro/biblioteca/covers/x.png' });
  });

  it('leaves a work alone that has a cover by the time the request arrives, and says so at INFO', async () => {
    const { listener, covers } = makeListener({ ...work, coverUrl: 'https://test.scriptorium.ro/biblioteca/covers/x.png' });
    const info = jest.spyOn((listener as any).log, 'log').mockImplementation(() => undefined);
    expect(await listener.handleEnrichWork('eminescu/poezii')).toBe(false);
    expect(covers.enqueue).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('work enrichment eminescu/poezii: nothing to do - it already has a cover (https://test.scriptorium.ro/biblioteca/covers/x.png)');
  });

  it('drops requests for unknown works and malformed ids without asking for a cover', async () => {
    const gone = makeListener(Object.assign(new Error('not found'), { status: 404 }));
    expect(await gone.listener.handleEnrichWork('nobody/nothing')).toBe(false);
    expect(gone.covers.enqueue).not.toHaveBeenCalled();

    const bad = makeListener(work);
    expect(await bad.listener.handleEnrichWork('not-a-work-id')).toBe(false);
    expect(bad.tbc.getElemByPath).not.toHaveBeenCalled();
  });

  it('still renders a cover, without art, when the author media lookup fails', async () => {
    const { listener, tbc, enqueued } = makeListener(work);
    tbc.getAuthor.mockRejectedValueOnce(new Error('server busy'));
    expect(await listener.handleEnrichWork('eminescu/poezii')).toBe(true);
    expect(enqueued[0].artUrl).toBeUndefined();
  });
});

/**
 * The exact production bug this change exists for: biblioteca-server's DB
 * says a work has a cover (coverUrl is set), but the MinIO object behind
 * that URL was deleted. Every reader card fell back to the placeholder
 * and - because every caller trusted the DB field - no cover was ever
 * re-ordered. These tests wire the REAL listener to the REAL
 * CoverEnrichmentService (only MinIO and the renderer are mocked), so the
 * whole chain DB claim -> MinIO verification -> re-order is pinned.
 */
describe('deleted-behind-the-database cover regeneration', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const DEAD_URL = 'http://minio.test/covers/eminescu/poezii-deadbeefcafe.png';

  function makeStack(getPartialObjectImpl: (key: string) => Promise<any>) {
    const persisted: any[] = [];
    const svc = new CoverEnrichmentService({ async persistEnrichment(update: any) { persisted.push(update); } } as any, {
      minioUrl: 'http://minio.test',
      minioCred: 'key:secret',
      coversApiUrl: 'http://covers.test',
    } as any);
    jest.spyOn((svc as any).minio!, 'getPartialObject').mockImplementation(async (_b: any, key: any) => getPartialObjectImpl(key));
    jest.spyOn((svc as any).minio!, 'putObject').mockImplementation(async () => ({}) as any);
    const tbc = {
      getElemByPath: jest.fn(async (path: string) => ({
        id: 7, head: 'Poezii', path, coverUrl: DEAD_URL,
        author: { strId: 'eminescu', displayName: 'Mihai Eminescu' },
      })),
      getAuthor: jest.fn(async () => ({ imageUrls: [], image_href: null })),
    };
    const listener = new WorkEnrichmentKafkaListenerService({} as any, tbc as any, svc as any, { kafka: {} } as any);
    return { listener, svc, persisted };
  }

  async function withStubbedRenderer(run: (renderAttempts: () => number) => Promise<void>) {
    const originalFetch = (global as any).fetch;
    let attempts = 0;
    (global as any).fetch = (async (url: any) => String(url).endsWith('/api/cover/meta')
      ? { ok: false, status: 500, json: async () => ({}) }
      : (attempts++, { ok: true, status: 200, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length) })) as any;
    try {
      await run(() => attempts);
    } finally {
      (global as any).fetch = originalFetch;
    }
  }

  async function drain(svc: CoverEnrichmentService) {
    // enqueue() verifies the stored cover in MinIO before queueing: let that settle first.
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
    for (let i = 0; i < 100 && ((svc as any).active > 0 || (svc as any).queue.length > 0); i++) {
      await new Promise(r => setImmediate(r));
    }
  }

  it('DB coverUrl set but object deleted from MinIO: the work is re-rendered and persisted with a new cover URL', async () => {
    const { listener, svc, persisted } = makeStack(async () => {
      throw Object.assign(new Error('Not Found'), { code: 'NotFound' });
    });

    await withStubbedRenderer(async (renderAttempts) => {
      expect(await listener.handleEnrichWork('eminescu/poezii')).toBe(true);
      await drain(svc);
      expect(renderAttempts()).toBe(1);
    });

    expect(persisted).toHaveLength(1);
    expect(persisted[0].opusId).toBe(7);
    expect(persisted[0].coverUrl).toMatch(/^http:\/\/minio\.test\/covers\/eminescu\/poezii-[0-9a-f]{12}\.png$/);
    expect(persisted[0].replaceCover).toBe(true);
  });

  it('DB coverUrl set and object verified in MinIO: nothing is re-rendered', async () => {
    const { listener, svc, persisted } = makeStack(async () =>
      (async function* () { yield PNG; })() as any);

    await withStubbedRenderer(async (renderAttempts) => {
      expect(await listener.handleEnrichWork('eminescu/poezii')).toBe(false);
      await drain(svc);
      expect(renderAttempts()).toBe(0);
    });

    expect(persisted).toHaveLength(0);
  });
});
