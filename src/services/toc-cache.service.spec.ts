/// <reference types="jest" />
import { TocCacheService } from './toc-cache.service';

/**
 * The `cache` module's pass over biblioteca-server's missing tables of
 * contents. A fake server: a set of works lacking a TOC, which a successful
 * build removes - as the real disk cache does.
 */
class FakeServer {
  missing: number[];
  failing = new Set<number>();
  built: number[] = [];
  listCalls = 0;
  constructor(missing: number[], public works = 50) { this.missing = [...missing]; }
  async missingTocs(limit = 100) {
    this.listCalls++;
    return { missing: this.missing.slice(0, limit), works: this.works };
  }
  async buildToc(id: number) {
    if (this.failing.has(id)) throw new Error('HTTP 500');
    this.built.push(id);
    this.missing = this.missing.filter(m => m !== id);
    return { divisions: 3, millis: 4 };
  }
}

const svcFor = (server: FakeServer) => new TocCacheService(server as any);

describe('TocCacheService', () => {
  it('builds every missing TOC, one at a time, across pages', async () => {
    const ids = Array.from({ length: 230 }, (_, i) => i + 1);
    const server = new FakeServer(ids, 400);

    const result = await svcFor(server).warmMissing({ pauseMs: 0 });

    expect(server.built).toEqual(ids);
    expect(server.missing).toEqual([]);
    expect(result).toMatchObject({ missing: 100, built: 230, failed: 0, works: 400, errors: [] });
  });

  it('does nothing when every work has its TOC', async () => {
    const server = new FakeServer([]);
    const result = await svcFor(server).warmMissing({ pauseMs: 0 });
    expect(result).toMatchObject({ missing: 0, built: 0, failed: 0 });
    expect(server.listCalls).toBe(1);
  });

  it('a failing work is tried once per pass and does not stop the others', async () => {
    const server = new FakeServer([1, 2, 3]);
    server.failing.add(2);

    const result = await svcFor(server).warmMissing({ pauseMs: 0 });

    expect(server.built).toEqual([1, 3]);
    expect(result.built).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual(['TOC of work 2: HTTP 500']);
  });

  it('stops between works when asked (a cancelled admin run)', async () => {
    const server = new FakeServer([1, 2, 3]);
    let checks = 0;
    const result = await svcFor(server).warmMissing({ pauseMs: 0, shouldStop: () => ++checks > 2 });
    expect(server.built.length).toBeLessThan(3);
    expect(result.built).toBe(server.built.length);
  });

  it('honours the build cap', async () => {
    const server = new FakeServer([1, 2, 3, 4]);
    const result = await svcFor(server).warmMissing({ pauseMs: 0, maxBuilds: 2 });
    expect(server.built).toEqual([1, 2]);
    expect(result.built).toBe(2);
  });
});
