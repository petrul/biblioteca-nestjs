import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EnrichmentAdminService, EnrichmentRunRequest } from './enrichment-admin.service';
import { ENRICHMENT_MODULES, ENRICHMENT_STEP_IDS } from './enrichment-modules';

/**
 * The manual enrichment admin surface. The assertions that matter most:
 *
 * - fill-only by default: already-enriched entities are never candidates,
 *   and every call into the enrich/cover services carries force: false;
 * - overwrite is threaded explicitly per request (never sticky) and is
 *   rejected for vectorize;
 * - the run lock is shared with EnrichmentService's daily sweep, and it
 *   is released however the job ends;
 * - dry-run is read-only: it lists candidates and calls nothing.
 *
 * Everything is faked - no fetch, no Kafka, no vector store.
 */

class FakeTbc {
  authors: any[] = [];
  opera: any[] = [];
  byPath: Record<string, any> = {};
  async getAuthors() { return this.authors; }
  async *allOperaGen() { for (const opus of this.opera) yield opus; }
  async getElemByPath(path: string) { return this.byPath[path]; }
}

class FakeEnrichment {
  canBegin = true;
  running = false;
  enrichAuthorCalls: { strId: string; force?: boolean }[] = [];
  enrichWorkCalls: { opusId: number; force?: boolean }[] = [];
  failFor = new Set<string>();
  // The real service returns the retrieved image URLs per entity - the
  // admin run threads the first into the cover order (see the combined
  // work+cover test).
  artFor = new Map<string, string[]>();
  tryBeginRun() { if (!this.canBegin || this.running) return false; this.running = true; return true; }
  endRun() { this.running = false; }
  isRunning() { return this.running; }
  async enrichAuthor(author: any, opts: { force?: boolean } = {}) {
    this.enrichAuthorCalls.push({ strId: author.strId, force: opts.force });
    if (this.failFor.has(author.strId)) throw new Error('wikipedia unreachable');
    return this.artFor.get(author.strId);
  }
  async enrichWork(opus: any, opts: { force?: boolean } = {}) {
    this.enrichWorkCalls.push({ opusId: opus.id, force: opts.force });
    if (this.failFor.has(`opus-${opus.id}`)) throw new Error('wikipedia unreachable');
    return this.artFor.get(`opus-${opus.id}`);
  }
}

class FakeCovers {
  enqueued: { id: number; hasCoverUrl: boolean; force?: boolean }[] = [];
  enqueuedCandidates: any[] = [];
  enqueue(candidate: any, opts: { force?: boolean } = {}): Promise<boolean> {
    this.enqueued.push({ id: candidate.id, hasCoverUrl: !!candidate.coverUrl, force: opts.force });
    this.enqueuedCandidates.push(candidate);
    return Promise.resolve(true);
  }
}

class FakeVectorizer {
  vectorized: number[] = [];
  async vectorize(id: number) { this.vectorized.push(id); }
}

function makeSvc(tbc: FakeTbc, enrichment: FakeEnrichment, covers: FakeCovers, vectorizer: FakeVectorizer,
  vectorizingRunning = false) {
  const vectorizingJob: any = { status: () => ({ running: vectorizingRunning }) };
  return new EnrichmentAdminService(tbc as any, enrichment as any, covers as any, vectorizer as any, vectorizingJob);
}

/** Runs the async job to completion (or the terminal state it reaches). */
async function waitJob(svc: EnrichmentAdminService, id: string) {
  for (let i = 0; i < 1000; i++) {
    const job = svc.get(id);
    if (job.state !== 'running') return job;
    await new Promise(r => setImmediate(r));
  }
  throw new Error('job did not settle');
}

describe('EnrichmentAdminService', () => {

  it('the module catalog is the steps list the run endpoint validates against', () => {
    expect(ENRICHMENT_STEP_IDS).toEqual(ENRICHMENT_MODULES.map(m => m.id));
    expect(ENRICHMENT_MODULES.find(m => m.id === 'vectorize')!.overwrite).toBe(false);
  });

  it('fill-only by default: enriched entities are skipped untouched, only the missing are enriched', async () => {
    const tbc = new FakeTbc();
    tbc.authors = [
      { strId: 'a1', displayName: 'Enriched One', bio: 'already there' },
      { strId: 'a2', displayName: 'Missing Two' },
    ];
    tbc.opera = [
      { id: 1, head: 'Enriched', completePath: 'p1', description: 'already there' },
      { id: 2, head: 'Missing', completePath: 'p2' },
    ];
    const enrichment = new FakeEnrichment();
    const svc = makeSvc(tbc, enrichment, new FakeCovers(), new FakeVectorizer());

    const job = await svc.start({ steps: ['author', 'work'] });
    const done = await waitJob(svc, job.id);

    expect(enrichment.enrichAuthorCalls).toEqual([{ strId: 'a2', force: false }]);
    expect(enrichment.enrichWorkCalls).toEqual([{ opusId: 2, force: false }]);
    expect(done.steps.author).toMatchObject({ candidates: 1, processed: 1, skippedExisting: 1, failed: 0 });
    expect(done.steps.work).toMatchObject({ candidates: 1, processed: 1, skippedExisting: 1, failed: 0 });
    expect(done.state).toBe('finished');
    expect(enrichment.running).toBe(false); // the shared lock was released
  });

  it('overwrite re-enriches everyone and threads force through every call', async () => {
    const tbc = new FakeTbc();
    tbc.authors = [{ strId: 'a1', displayName: 'Enriched One', bio: 'already there' }];
    tbc.opera = [{ id: 1, head: 'Enriched', completePath: 'p1', description: 'already there' }];
    const enrichment = new FakeEnrichment();
    const svc = makeSvc(tbc, enrichment, new FakeCovers(), new FakeVectorizer());

    const job = await svc.start({ steps: ['author', 'work'], overwrite: true });
    const done = await waitJob(svc, job.id);

    expect(enrichment.enrichAuthorCalls).toEqual([{ strId: 'a1', force: true }]);
    expect(enrichment.enrichWorkCalls).toEqual([{ opusId: 1, force: true }]);
    expect(done.steps.author!.skippedExisting).toBe(0);
    expect(done.request.overwrite).toBe(true);
  });

  it('targets restrict the run to the named entities only', async () => {
    const tbc = new FakeTbc();
    tbc.authors = [
      { strId: 'a1', displayName: 'One' },
      { strId: 'a2', displayName: 'Two' },
    ];
    const enrichment = new FakeEnrichment();
    const svc = makeSvc(tbc, enrichment, new FakeCovers(), new FakeVectorizer());

    await waitJob(svc, (await svc.start({ steps: ['author'], targets: { authorStrIds: ['a2'] } })).id);

    expect(enrichment.enrichAuthorCalls).toEqual([{ strId: 'a2', force: false }]);
  });

  it('the cover step enqueues only cover-less opera unless forced', async () => {
    const tbc = new FakeTbc();
    tbc.opera = [
      { id: 1, head: 'Has Cover', completePath: 'p1', coverUrl: 'https://x/c1.png' },
      { id: 2, head: 'Coverless', completePath: 'p2' },
    ];
    const covers = new FakeCovers();
    const svc = makeSvc(tbc, new FakeEnrichment(), covers, new FakeVectorizer());

    await waitJob(svc, (await svc.start({ steps: ['cover'] })).id);
    expect(covers.enqueued).toEqual([{ id: 2, hasCoverUrl: false, force: false }]);

    const covers2 = new FakeCovers();
    const svc2 = makeSvc(tbc, new FakeEnrichment(), covers2, new FakeVectorizer());
    await waitJob(svc2, (await svc2.start({ steps: ['cover'], overwrite: true })).id);
    expect(covers2.enqueued).toEqual([
      { id: 1, hasCoverUrl: true, force: true },
      { id: 2, hasCoverUrl: false, force: true },
    ]);
  });

  it('a work+cover run enriches first and threads the retrieved art into the cover order', async () => {
    const tbc = new FakeTbc();
    tbc.authors = [{ strId: 'a1', displayName: 'An Author' }];
    tbc.opera = [
      // no art of its own -> falls back to the author portrait the
      // author step retrieved earlier in the same run
      { id: 1, head: 'Fallback', completePath: 'p1', author: { strId: 'a1', displayName: 'An Author' } },
      // its own art -> the work step's return wins over the portrait
      { id: 2, head: 'Own Art', completePath: 'p2', author: { strId: 'a1', displayName: 'An Author' } },
    ];
    const enrichment = new FakeEnrichment();
    enrichment.artFor.set('a1', ['https://upload.wikimedia.org/author.jpg']);
    enrichment.artFor.set('opus-2', ['https://commons.wikimedia.org/wiki/Special:FilePath/Work_Art.jpg?width=1200']);
    const covers = new FakeCovers();
    const svc = makeSvc(tbc, enrichment, covers, new FakeVectorizer());

    await waitJob(svc, (await svc.start({ steps: ['author', 'work', 'cover'] })).id);

    expect(enrichment.enrichWorkCalls).toEqual([{ opusId: 1, force: false }, { opusId: 2, force: false }]);
    expect(covers.enqueuedCandidates).toEqual([
      expect.objectContaining({ id: 1, artUrl: 'https://upload.wikimedia.org/author.jpg' }),
      expect.objectContaining({ id: 2, artUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Work_Art.jpg?width=1200' }),
    ]);
  });

  it('dry run lists the candidates under the requested semantics and calls nothing', async () => {
    const tbc = new FakeTbc();
    tbc.authors = [
      { strId: 'a1', displayName: 'Enriched One', bio: 'already there' },
      { strId: 'a2', displayName: 'Missing Two' },
    ];
    tbc.opera = [{ id: 2, head: 'Missing', completePath: 'p2' }];
    const enrichment = new FakeEnrichment();
    const covers = new FakeCovers();
    const svc = makeSvc(tbc, enrichment, covers, new FakeVectorizer());

    const fillOnly = await svc.dryRun({ steps: ['author', 'work', 'cover'] });
    expect(fillOnly.totals).toEqual({ author: 1, work: 1, cover: 1 });
    expect(fillOnly.authors.map(a => a.strId)).toEqual(['a2']);
    expect(fillOnly.works.map(w => w.id)).toEqual([2]);
    expect(fillOnly.covers.map(c => c.id)).toEqual([2]);

    const overwrite = await svc.dryRun({ steps: ['author'], overwrite: true });
    expect(overwrite.totals.author).toBe(2);

    expect(enrichment.enrichAuthorCalls).toHaveLength(0);
    expect(enrichment.enrichWorkCalls).toHaveLength(0);
    expect(covers.enqueued).toHaveLength(0);
    expect(enrichment.running).toBe(false); // a dry run never takes the lock
  });

  it('vectorize delegates per-opus to the vectorizer and is fill-only by construction', async () => {
    const tbc = new FakeTbc();
    tbc.byPath = { 'p1': { id: 42, head: 'Lume', path: 'p1' }, 'p2': { id: 43, head: 'Alt', path: 'p2' } };
    const vectorizer = new FakeVectorizer();
    const svc = makeSvc(tbc, new FakeEnrichment(), new FakeCovers(), vectorizer);

    await waitJob(svc, (await svc.start({ steps: ['vectorize'], targets: { opusPaths: ['p1', 'p2'] } })).id);

    expect(vectorizer.vectorized).toEqual([42, 43]);
  });

  it('a failed entity never aborts the rest; the first errors are recorded', async () => {
    const tbc = new FakeTbc();
    tbc.authors = [
      { strId: 'bad', displayName: 'Fails' },
      { strId: 'good', displayName: 'Works' },
    ];
    const enrichment = new FakeEnrichment();
    enrichment.failFor.add('bad');
    const svc = makeSvc(tbc, enrichment, new FakeCovers(), new FakeVectorizer());

    const done = await waitJob(svc, (await svc.start({ steps: ['author'] })).id);

    expect(done.steps.author).toMatchObject({ candidates: 2, processed: 1, failed: 1 });
    expect(done.errors).toEqual(['author bad: wikipedia unreachable']);
    expect(done.state).toBe('finished');
  });

  it('cancel is cooperative: the running job stops after its current entity', async () => {
    const tbc = new FakeTbc();
    tbc.authors = [
      { strId: 'a1', displayName: 'One' },
      { strId: 'a2', displayName: 'Two' },
      { strId: 'a3', displayName: 'Three' },
    ];
    const enrichment = new FakeEnrichment();
    const svc = makeSvc(tbc, enrichment, new FakeCovers(), new FakeVectorizer());

    const job = await svc.start({ steps: ['author'] });
    svc.cancel(job.id); // races the walk's first microtasks - it always lands during the run
    const done = await waitJob(svc, job.id);

    expect(done.state).toBe('cancelled');
    // at most the entity in flight when cancel landed - never the whole list
    expect(enrichment.enrichAuthorCalls.length).toBeLessThan(tbc.authors.length);
    expect(enrichment.running).toBe(false);
  });

  it('rejects unknown steps, empty steps, vectorize without targets and overwrite with vectorize', async () => {
    const svc = makeSvc(new FakeTbc(), new FakeEnrichment(), new FakeCovers(), new FakeVectorizer());
    const req = (r: EnrichmentRunRequest) => expect(svc.start(r)).rejects.toThrow(BadRequestException);
    await req({ steps: [] } as EnrichmentRunRequest);
    await req({ steps: ['author', 'teleport'] as any });
    await req({ steps: ['vectorize'] });
    await req({ steps: ['vectorize'], targets: { opusPaths: ['p1'] }, overwrite: true });
    await expect(svc.dryRun({ steps: ['vectorize'] })).rejects.toThrow(BadRequestException);
  });

  it('refuses to start while another enrichment run holds the shared lock', async () => {
    const enrichment = new FakeEnrichment();
    enrichment.canBegin = false;
    const svc = makeSvc(new FakeTbc(), enrichment, new FakeCovers(), new FakeVectorizer());
    await expect(svc.start({ steps: ['author'] })).rejects.toThrow(ConflictException);
  });

  it('refuses the vectorize step while the bulk vectorizing job is running', async () => {
    const svc = makeSvc(new FakeTbc(), new FakeEnrichment(), new FakeCovers(), new FakeVectorizer(), true);
    await expect(svc.start({ steps: ['vectorize'], targets: { opusPaths: ['p1'] } })).rejects.toThrow(ConflictException);
  });

  it('per-entity reads: which fields are present, and NotFound for the unknown', async () => {
    const tbc = new FakeTbc();
    tbc.authors = [{ strId: 'a1', displayName: 'One', bio: 'there', birthDate: '1850' }];
    tbc.byPath = { 'p1': { id: 7, head: 'Lume', path: 'p1', coverUrl: 'https://x/c.png' } };
    const svc = makeSvc(tbc, new FakeEnrichment(), new FakeCovers(), new FakeVectorizer());

    expect(await svc.authorStatus('a1')).toEqual({
      strId: 'a1',
      displayName: 'One',
      enriched: {
        bio: true, bioSourceUrl: false, birthDate: true, deathDate: false,
        birthPlace: false, country: false, writingLanguage: false, imageUrls: false,
      },
    });
    expect(await svc.workStatus('p1')).toEqual({
      id: 7, head: 'Lume', path: 'p1',
      enriched: { description: false, significantQuote: false, coverUrl: true },
    });
    await expect(svc.authorStatus('nobody')).rejects.toThrow(NotFoundException);
    await expect(svc.workStatus('nowhere')).rejects.toThrow(NotFoundException);
  });

  it('jobs are listed newest first and the single-flight lock survives a failed run', async () => {
    const tbc = new FakeTbc();
    tbc.authors = [{ strId: 'a1', displayName: 'One' }];
    const enrichment = new FakeEnrichment();
    const svc = makeSvc(tbc, enrichment, new FakeCovers(), new FakeVectorizer());

    const first = await waitJob(svc, (await svc.start({ steps: ['author'] })).id);
    const second = await waitJob(svc, (await svc.start({ steps: ['author'] })).id);

    const listed = svc.list();
    expect(listed[0].id).toBe(second.id);
    expect(listed[1].id).toBe(first.id);
    expect(svc.current()).toBeNull();
    expect(enrichment.running).toBe(false);
    // a failed getAuthors (fatal, before the loop) also releases the lock
    const brokenTbc = new FakeTbc();
    (brokenTbc as any).getAuthors = async () => { throw new Error('server down'); };
    const svc2 = makeSvc(brokenTbc, enrichment, new FakeCovers(), new FakeVectorizer());
    const failed = await waitJob(svc2, (await svc2.start({ steps: ['author'] })).id);
    expect(failed.state).toBe('failed');
    expect(enrichment.running).toBe(false);
  });
});
