/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common';
import { CoverAdminController } from './cover-admin.controller';
import { EnrichmentAdminService } from './services/enrichment-admin.service';

/**
 * The independent cover-only admin surface (/api/covers). The
 * assertions that matter:
 *
 * - every run/dry-run delegates to the enrichment job machinery as a
 *   cover-only request with overwrite hard-wired to false;
 * - there is no overwrite switch: a body carrying overwrite is refused
 *   with a 400 before anything is started;
 * - end-to-end through the real EnrichmentAdminService: an opus that
 *   already has a cover is never re-enqueued, so existing covers are
 *   never overwritten;
 * - the job routes are thin delegation.
 *
 * Everything is faked - no fetch, no MinIO, no Kafka.
 */

/** Minimal recording fake for the delegation tests. */
class FakeAdmin {
  started: any[] = [];
  dryRuns: any[] = [];
  listed = 0;
  got: string[] = [];
  cancelled: string[] = [];
  async start(request: any) { this.started.push(request); return { id: 'job-1' }; }
  async dryRun(request: any) { this.dryRuns.push(request); return { totals: {} }; }
  list() { this.listed++; return []; }
  get(id: string) { this.got.push(id); return { id }; }
  cancel(id: string) { this.cancelled.push(id); return { cancelled: true, state: 'running' }; }
}

function makeController(admin: FakeAdmin = new FakeAdmin()) {
  return { controller: new CoverAdminController(admin as any), admin };
}

describe('CoverAdminController (independent /api/covers surface)', () => {

  it('run delegates a cover-only request with overwrite hard-wired to false', async () => {
    const { controller, admin } = makeController();
    const targets = { opusPaths: ['opera/alecsandri/lume-ridicata.xml'] };

    const job = await controller.run({ targets } as any);

    expect(job).toEqual({ id: 'job-1' });
    expect(admin.started).toEqual([{ steps: ['cover'], targets, overwrite: false }]);
  });

  it('rejects overwrite before anything is started: existing covers are never at risk', async () => {
    const { controller, admin } = makeController();

    await expect(controller.run({ overwrite: true } as any)).rejects.toThrow(BadRequestException);
    await expect(controller.dryRun({ overwrite: true } as any)).rejects.toThrow(BadRequestException);

    expect(admin.started).toHaveLength(0);
    expect(admin.dryRuns).toHaveLength(0);
  });

  it('dry-run delegates the same fill-only request and calls nothing', async () => {
    const { controller, admin } = makeController();

    await controller.dryRun({} as any);

    expect(admin.dryRuns).toEqual([{ steps: ['cover'], targets: undefined, overwrite: false }]);
    expect(admin.started).toHaveLength(0);
  });

  it('the job routes are thin delegation', async () => {
    const { controller, admin } = makeController();

    controller.jobs();
    await controller.job('job-1');
    await controller.cancel('job-1');

    expect(admin.listed).toBe(1);
    expect(admin.got).toEqual(['job-1']);
    expect(admin.cancelled).toEqual(['job-1']);
  });

  it('end-to-end: a cover-only run enqueues only coverless opera, existing covers stay untouched', async () => {
    // The real service the controller delegates to, over the same style
    // of fakes as enrichment-admin.service.spec.ts.
    const tbc: any = {
      async getAuthors() { return []; },
      async *allOperaGen() {
        yield { id: 1, head: 'Has Cover', completePath: 'p1', coverUrl: 'https://x/c1.png' };
        yield { id: 2, head: 'Coverless', completePath: 'p2' };
      },
    };
    const covers: any = { enqueued: [] as any[], enqueue(candidate: any, opts: any = {}) { this.enqueued.push({ ...candidate, force: opts.force }); } };
    const svc = new EnrichmentAdminService(tbc, { tryBeginRun: () => true, endRun: () => {}, storedAuthorArt: async () => undefined } as any, covers, {} as any, { status: () => ({ running: false }) } as any);
    const controller = new CoverAdminController(svc);

    const job: any = await controller.run({} as any);
    for (let i = 0; i < 1000 && svc.get(job.id).state === 'running'; i++) {
      await new Promise(r => setImmediate(r));
    }

    // only the coverless opus, force always false: an existing cover
    // (however it was retrieved) is never re-rendered. The author is the
    // completePath's leading segment - the SDR walk data has no author,
    // and no author of that strId exists to resolve a display name.
    expect(covers.enqueued).toEqual([
      { id: 2, path: 'p2', title: 'Coverless', author: 'p2', coverUrl: undefined, artUrl: undefined, force: false },
    ]);
    expect(svc.get(job.id).steps.cover).toMatchObject({ candidates: 1, skippedExisting: 1, failed: 0 });
  });
});
