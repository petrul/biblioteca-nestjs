import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BibliotecaClient } from './biblioteca_client.service';
import { CoverEnrichmentService } from './cover-enrichment.service';
import { EnrichmentService } from './enrichment.service';
import { ENRICHMENT_STEP_IDS, EnrichmentStep } from './enrichment-modules';
import { VectorizerService } from './vectorizer.service';
import { VectorizingJobService } from './vectorizing_job.service';

/** A manual enrichment run's request body (POST /api/enrichment/run). */
export interface EnrichmentRunRequest {
  /** Which modules to run; validated against the ENRICHMENT_MODULES catalog. */
  steps: EnrichmentStep[];
  /** Restrict the run to these entities; omitted = the whole corpus. */
  targets?: { authorStrIds?: string[]; opusPaths?: string[] };
  /**
   * Default (and always the automatic callers') semantics: every step
   * only enriches what is not enriched yet, existing data is never
   * touched. True - an explicit, per-request switch that is never sticky
   * - re-enriches already-enriched entities and asks the server to
   * replace their data. Rejected for the vectorize step.
   */
  overwrite?: boolean;
}

export type EnrichmentJobState = 'running' | 'finished' | 'cancelled' | 'failed';

export interface EnrichmentStepCounters {
  /** Entities actually attempted (their data was missing, or overwrite forced it). */
  candidates: number;
  /** Candidates processed without error (a no-extract Wikipedia hit counts as processed, not failed). */
  processed: number;
  /** Fill-only mode only: already enriched, deliberately left untouched. */
  skippedExisting: number;
  failed: number;
}

export interface EnrichmentJobStatus {
  id: string;
  request: EnrichmentRunRequest;
  state: EnrichmentJobState;
  /** POST .../cancel was called; honored between entities. */
  cancelRequested: boolean;
  steps: Partial<Record<EnrichmentStep, EnrichmentStepCounters>>;
  /** Capped list - the first errors, not all of them. */
  errors: string[];
  /** Epoch ms. */
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

/** GET /api/enrichment/run/dry-run's answer: the candidates, no external call made. */
export interface EnrichmentDryRun {
  overwrite: boolean;
  totals: Partial<Record<EnrichmentStep, number>>;
  truncated: boolean;
  authors: { strId: string; displayName?: string; alreadyEnriched: boolean }[];
  works: { id: number; head?: string; path?: string; alreadyEnriched: boolean }[];
  covers: { id: number; head?: string; path?: string; alreadyEnriched: boolean }[];
}

type Job = EnrichmentJobStatus;

/**
 * Owns the manual enrichment admin surface (see EnrichmentAdminController
 * for the routes): retriggering enrichment integrally or partially, on
 * all authors/works or on explicit targets. The fill-only invariant is
 * enforced in three independent layers - candidate selection here, the
 * guards inside EnrichmentService/CoverEnrichmentService, and the
 * server's blank-fill-only persistence contract - and overwrite is an
 * explicit per-request switch that is never sticky.
 *
 * Runs are async (POST run answers 202 with the job id immediately) and
 * share EnrichmentService's single-flight lock with the daily sweep, so
 * a manual run and the 03:00 backstop never walk the corpus at the same
 * time. Cancel is cooperative, honored between entities.
 */
@Injectable()
export class EnrichmentAdminService {
  private readonly log = new Logger(EnrichmentAdminService.name);
  private readonly jobs: Job[] = [];
  private static readonly MAX_JOBS_REMEMBERED = 20;
  private static readonly MAX_ERRORS_RECORDED = 20;
  private static readonly MAX_DRY_RUN_LISTED = 200;

  constructor(
    protected client: BibliotecaClient,
    protected enrichment: EnrichmentService,
    protected covers: CoverEnrichmentService,
    protected vectorizer: VectorizerService,
    protected vectorizingJob: VectorizingJobService,
  ) {}

  current(): Job | null {
    return this.jobs.find(job => job.state === 'running') ?? null;
  }

  list(): Job[] {
    return [...this.jobs].sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): Job {
    const job = this.jobs.find(j => j.id === id);
    if (!job) throw new NotFoundException(`no enrichment job '${id}'`);
    return job;
  }

  /** Asks the running job to stop after its current entity. */
  cancel(id: string): { cancelled: boolean; state: EnrichmentJobState; reason?: string } {
    const job = this.get(id);
    if (job.state !== 'running') {
      return { cancelled: false, state: job.state, reason: `job already ${job.state}` };
    }
    job.cancelRequested = true;
    job.updatedAt = Date.now();
    this.log.log(`cancel requested for enrichment job ${id}`);
    return { cancelled: true, state: job.state };
  }

  /**
   * Validates and starts an asynchronous enrichment job. The returned
   * status is the live job object - poll GET /api/enrichment/jobs/:id.
   */
  async start(request: EnrichmentRunRequest): Promise<Job> {
    this.validate(request, { checkVectorizingJob: true });
    if (!this.enrichment.tryBeginRun()) {
      throw new ConflictException('an enrichment run is already in progress (the daily sweep or another manual run) - see GET /api/enrichment/jobs');
    }
    const job: Job = {
      id: randomUUID(),
      request: { ...request, overwrite: request.overwrite === true },
      state: 'running',
      cancelRequested: false,
      steps: Object.fromEntries(request.steps.map(step => [step, this.zeroCounters()])),
      errors: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
      finishedAt: null,
    };
    this.jobs.unshift(job);
    if (this.jobs.length > EnrichmentAdminService.MAX_JOBS_REMEMBERED) this.jobs.length = EnrichmentAdminService.MAX_JOBS_REMEMBERED;
    this.log.log(`enrichment job ${job.id} started: steps [${request.steps.join(', ')}]${request.targets ? `, targets ${JSON.stringify(request.targets)}` : ''}${job.request.overwrite ? ', OVERWRITE' : ''}`);
    void this.execute(job);
    return job;
  }

  /**
   * The candidates a run with this request would process, without a
   * single external call: fill-only mode lists the not-yet-enriched,
   * overwrite mode lists everyone. Free to click from Swagger UI.
   */
  async dryRun(request: EnrichmentRunRequest): Promise<EnrichmentDryRun> {
    this.validate(request, { checkVectorizingJob: false });
    const force = request.overwrite === true;
    const result: EnrichmentDryRun = { overwrite: force, totals: {}, truncated: false, authors: [], works: [], covers: [] };
    const add = (step: EnrichmentStep) => { result.totals[step] = (result.totals[step] ?? 0) + 1; };
    const wants = (step: EnrichmentStep) => request.steps.includes(step);
    const cap = (list: unknown[]) => { if (list.length >= EnrichmentAdminService.MAX_DRY_RUN_LISTED) result.truncated = true; return list.length < EnrichmentAdminService.MAX_DRY_RUN_LISTED; };

    if (wants('author')) {
      for (const author of (await this.client.getAuthors()) as any[]) {
        if (!this.authorTargeted(author, request) || (author.bio && !force)) continue;
        add('author');
        if (cap(result.authors)) result.authors.push({ strId: author.strId, displayName: author.displayName, alreadyEnriched: !!author.bio });
      }
    }
    if (wants('work') || wants('cover')) {
      for await (const opus of this.client.allOperaGen() as any) {
        if (!this.opusTargeted(opus, request)) continue;
        if (wants('work') && ((!opus.description && !opus.significantQuote) || force)) {
          add('work');
          if (cap(result.works)) result.works.push({ id: opus.id, head: opus.head, path: opus.completePath, alreadyEnriched: !!(opus.description || opus.significantQuote) });
        }
        if (wants('cover') && (!opus.coverUrl || force)) {
          add('cover');
          if (cap(result.covers)) result.covers.push({ id: opus.id, head: opus.head, path: opus.completePath, alreadyEnriched: !!opus.coverUrl });
        }
      }
    }
    return result;
  }

  /** Which author fields are present on the server - the per-entity read side. */
  async authorStatus(strId: string) {
    const author = ((await this.client.getAuthors()) as any[]).find(a => a.strId === strId);
    if (!author) throw new NotFoundException(`no author '${strId}'`);
    return {
      strId: author.strId,
      displayName: author.displayName,
      enriched: this.presentFields(author, ['bio', 'bioSourceUrl', 'birthDate', 'deathDate', 'birthPlace', 'country', 'writingLanguage', 'imageUrls']),
    };
  }

  /** Which work fields are present on the server - the per-entity read side. */
  async workStatus(path: string) {
    const opus = await this.client.getElemByPath(path) as any;
    if (!opus?.id) throw new NotFoundException(`no opus at path '${path}'`);
    return {
      id: opus.id,
      head: opus.head,
      path: opus.path ?? path,
      enriched: this.presentFields(opus, ['description', 'significantQuote', 'coverUrl']),
    };
  }

  private presentFields(entity: any, fields: string[]): Record<string, boolean> {
    return Object.fromEntries(fields.map(f => [f, Array.isArray(entity?.[f]) ? entity[f].length > 0 : !!entity?.[f]]));
  }

  /**
   * The one validation gate for both run and dry-run: unknown step names
   * and the two vectorize-specific refusals are caught here, before any
   * external call - so the module catalog and the run endpoint cannot
   * disagree about what exists.
   */
  private validate(request: EnrichmentRunRequest, opts: { checkVectorizingJob: boolean }): void {
    if (!request.steps?.length) {
      throw new BadRequestException(`at least one step is required: ${ENRICHMENT_STEP_IDS.join(' | ')}`);
    }
    const unknown = request.steps.filter(s => !ENRICHMENT_STEP_IDS.includes(s));
    if (unknown.length) {
      throw new BadRequestException(`unknown enrichment step(s): ${unknown.join(', ')} - see GET /api/enrichment/modules`);
    }
    if (request.overwrite === true && request.steps.includes('vectorize')) {
      throw new BadRequestException('overwrite does not apply to vectorize: vectors are never dropped or replaced, vectorize() only adds the missing ones ("vectors are precious")');
    }
    if (request.steps.includes('vectorize')) {
      if (!request.targets?.opusPaths?.length) {
        throw new BadRequestException('the vectorize step needs explicit targets.opusPaths (one or more opus paths); a full-corpus run belongs to POST /api/vectorizing/start');
      }
      if (opts.checkVectorizingJob && this.vectorizingJob.status().running) {
        throw new ConflictException('a vectorizing run is already in progress (see GET /api/vectorizing)');
      }
    }
  }

  private async execute(job: Job): Promise<void> {
    const force = job.request.overwrite === true;
    try {
      if (job.request.steps.includes('author')) await this.runAuthors(job, force);
      if (job.request.steps.includes('work') || job.request.steps.includes('cover')) await this.runOpera(job, force);
      if (job.request.steps.includes('vectorize')) await this.runVectorize(job);
      job.state = job.cancelRequested ? 'cancelled' : 'finished';
    } catch (e: any) {
      job.state = 'failed';
      this.recordError(job, `${e?.message ?? e}`);
      this.log.error(`enrichment job ${job.id} failed: ${e?.message ?? e}`);
    } finally {
      job.finishedAt = Date.now();
      job.updatedAt = Date.now();
      this.enrichment.endRun();
      this.log.log(`enrichment job ${job.id} ${job.state}`);
    }
  }

  private async runAuthors(job: Job, force: boolean): Promise<void> {
    const counters = job.steps.author!;
    for (const author of (await this.client.getAuthors()) as any[]) {
      if (job.cancelRequested) return;
      if (!this.authorTargeted(author, job.request)) continue;
      if (author.bio && !force) { counters.skippedExisting++; continue; }
      counters.candidates++;
      try {
        this.log.log(`enrichment candidate author ${author.strId}`);
        await this.enrichment.enrichAuthor(author, { force });
        counters.processed++;
      } catch (e: any) {
        counters.failed++;
        this.recordError(job, `author ${author.strId}: ${e?.message ?? e}`);
      }
    }
  }

  /** The single walk over all opera shared by the work and cover steps. */
  private async runOpera(job: Job, force: boolean): Promise<void> {
    const wantsWork = job.request.steps.includes('work');
    const wantsCover = job.request.steps.includes('cover');
    for await (const opus of this.client.allOperaGen() as any) {
      if (job.cancelRequested) return;
      if (!this.opusTargeted(opus, job.request)) continue;
      if (wantsCover && opus.id && opus.completePath && opus.head) {
        const coverCounters = job.steps.cover!;
        if (opus.coverUrl && !force) { coverCounters.skippedExisting++; }
        else {
          coverCounters.candidates++;
          // CoverEnrichmentService.enqueue enforces the same fill-only
          // rule on its own; force is threaded through so the switch
          // does not have to rely on this caller's arithmetic.
          this.covers.enqueue({
            id: opus.id,
            path: opus.completePath,
            title: opus.head,
            author: opus.author?.visualName || opus.author?.displayName || 'Anonymous',
            coverUrl: opus.coverUrl,
          }, { force });
        }
      }
      if (wantsWork) {
        const workCounters = job.steps.work!;
        if ((opus.description || opus.significantQuote) && !force) { workCounters.skippedExisting++; continue; }
        workCounters.candidates++;
        try {
          this.log.log(`enrichment candidate work ${opus.id} ${opus.head}`);
          await this.enrichment.enrichWork(opus, { force });
          workCounters.processed++;
        } catch (e: any) {
          workCounters.failed++;
          this.recordError(job, `opus ${opus.id} ${opus.head}: ${e?.message ?? e}`);
        }
      }
    }
  }

  /**
   * Per-opus vectorization - fill-only by construction, like every
   * vector code path: VectorizerService.vectorize() asks the store which
   * sha256s are already embedded and only embeds the rest. It never
   * drops anything; the manual-only drops keep their own endpoints
   * (POST /api/vector-store/remove-opus and /reset).
   */
  private async runVectorize(job: Job): Promise<void> {
    const counters = job.steps.vectorize!;
    for (const path of job.request.targets!.opusPaths!) {
      if (job.cancelRequested) return;
      counters.candidates++;
      try {
        const opus = await this.client.getElemByPath(path) as any;
        if (!opus?.id) throw new Error(`no opus at path '${path}'`);
        await this.vectorizer.vectorize(opus.id);
        counters.processed++;
      } catch (e: any) {
        counters.failed++;
        this.recordError(job, `vectorize ${path}: ${e?.message ?? e}`);
      }
    }
  }

  private authorTargeted(author: any, request: EnrichmentRunRequest): boolean {
    const wanted = request.targets?.authorStrIds;
    return !wanted?.length || wanted.includes(author?.strId);
  }

  private opusTargeted(opus: any, request: EnrichmentRunRequest): boolean {
    const wanted = request.targets?.opusPaths;
    return !wanted?.length || wanted.includes(opus?.completePath ?? opus?.path);
  }

  private zeroCounters(): EnrichmentStepCounters {
    return { candidates: 0, processed: 0, skippedExisting: 0, failed: 0 };
  }

  private recordError(job: Job, message: string): void {
    if (job.errors.length < EnrichmentAdminService.MAX_ERRORS_RECORDED) job.errors.push(message);
  }
}
