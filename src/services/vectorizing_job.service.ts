import { Injectable, Logger } from '@nestjs/common';
import { BibliotecaClient } from './biblioteca_client.service';
import { VectorizerService } from './vectorizer.service';
import { StopWatch, Util } from '../util';
import { EntityModelTeiDiv } from '../biblioteca.api';

export type VectorizingState =
  'idle'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'finished';

export interface VectorizingOpusStatus {
  id: number;
  head: string | null;
  path: string | null;
}

/**
 * Progress of the single bulk vectorizing job, served by
 * GET /api/vectorizing (and embedded in GET /api/status).
 */
export interface VectorizingStatus {
  /**
   * Derived from the rest: idle (never ran), running, pausing (a pause was
   * requested but the current batch is still in flight), paused (halted,
   * resumable), finished (ran to completion).
   */
  state: VectorizingState;
  /** POST /api/vectorizing/pause was called; the run halts after the current batch. */
  pauseRequested: boolean;
  /** POST /api/vectorizing/resume would continue a paused run from here. */
  canResume: boolean;
  running: boolean;
  totalOpera: number | null;
  completedOpera: number;
  currentOpus: VectorizingOpusStatus | null;
  processedParas: number;
  /** Epoch ms. */
  startedAt: number | null;
  updatedAt: number | null;
  finishedAt: number | null;
}

/**
 * Owns the single bulk vectorizing job: a fresh full walk of every opus
 * (start), halting it (pause - honored at batch granularity through
 * VectorizerService's stop flag) and continuing from where a pause
 * halted it (resume - via the in-memory set of completed opus ids, so a
 * progress bar continues toward the same total instead of restarting).
 */
@Injectable()
export class VectorizingJobService {

  protected vectorizing: Omit<VectorizingStatus, 'state' | 'pauseRequested' | 'canResume'> = {
    running: false,
    totalOpera: null,
    completedOpera: 0,
    currentOpus: null,
    processedParas: 0,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
  };

  /** Opera completed by the current/most recent run - in memory only. */
  protected completedOpusIds = new Set<number>();

  constructor(protected tbc: BibliotecaClient, protected vectorizer: VectorizerService) {}

  private readonly log = new Logger(VectorizingJobService.name);

  status(): VectorizingStatus {
    const state = this.computeState();
    return {
      ...this.vectorizing,
      state,
      pauseRequested: this.vectorizer.isStopRequested(),
      canResume: state === 'paused',
    };
  }

  protected computeState(): VectorizingState {
    if (this.vectorizing.running) {
      return this.vectorizer.isStopRequested() ? 'pausing' : 'running';
    }
    if (this.vectorizing.totalOpera == null) return 'idle';
    return this.vectorizing.completedOpera < this.vectorizing.totalOpera ? 'paused' : 'finished';
  }

  /** Starts a fresh full run, optionally in random order; resolves when it completes. */
  async start(shuffle = false): Promise<VectorizingStatus> {
    this.vectorizer.clearStop();

    // Deliberately does NOT truncate the collection first anymore (that
    // used to live here - see git history). It was load-bearing for
    // Milvus's append-only binlog storage (a full re-run onto a stale
    // collection left tens of GB of unreclaimed MinIO objects, observed in
    // prod: 40G of binlogs for a collection holding ~3% of the corpus),
    // but Qdrant's upsertNewOrModified() already dedups by content hash -
    // re-walking every opus just re-confirms what's already embedded and
    // writes only what's actually new, no garbage accumulates. Dropping a
    // vector collection is real, uncapped GPU/embedding cost to
    // regenerate (observed in production: an in-memory-only nestjs
    // restart plus a `start()` call here wiped tens of thousands of
    // already-computed vectors, hours of re-embedding lost for nothing).
    // As a hard rule this app now never truncates a collection on its own
    // under any code path - VectorStore.reset()/drop() remain available
    // as explicit, manual-only operations for anyone who really means to
    // wipe one (e.g. after an encoder change makes old vectors
    // incompatible), never something a routine "start a run" call does
    // for you.
    const opera = await this.collectOpera();
    if (shuffle) {
      Util.shuffleArray(opera);
    }
    this.log.log(`opera length: ${opera.length}`);

    this.completedOpusIds.clear();
    this.vectorizing = {
      running: true,
      totalOpera: opera.length,
      completedOpera: 0,
      currentOpus: null,
      processedParas: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      finishedAt: null,
    };

    await this.vectorizeOpera(opera);
    return this.status();
  }

  /** Halts the run after its current batch; resume continues from here. */
  pause(): { paused: boolean } {
    this.vectorizer.requestStop();
    return { paused: true };
  }

  /**
   * Continues the most recent run from where pause halted it: opera already
   * completed are skipped (in memory only, so after an app restart there is
   * nothing recorded to resume from - then a fresh start() is needed), the
   * rest are vectorized, and the progress totals continue toward the same
   * goal. An opus interrupted mid-way is not counted as completed and thus
   * gets fully re-vectorized here.
   */
  async resume(): Promise<{ resumed: boolean; reason?: string; remaining?: number }> {
    if (this.vectorizing.running) {
      return { resumed: false, reason: 'a vectorizing run is already in progress' };
    }
    if (this.vectorizing.totalOpera == null) {
      return { resumed: false, reason: 'no previous vectorizing run to resume' };
    }

    const opera = await this.collectOpera();
    const remaining = opera.filter(op => !this.completedOpusIds.has(op.id));
    this.log.log(`resume: ${remaining.length} of ${opera.length} opera remain`);

    this.vectorizer.clearStop();
    this.vectorizing = {
      ...this.vectorizing,
      running: true,
      totalOpera: opera.length,
      currentOpus: null,
      finishedAt: null,
      updatedAt: Date.now(),
    };

    await this.vectorizeOpera(remaining);
    return { resumed: true, remaining: remaining.length };
  }

  protected async collectOpera(): Promise<EntityModelTeiDiv[]> {
    const opera: EntityModelTeiDiv[] = [];
    for await(const i of this.tbc.allOperaGen()) {
      if (i)
        opera.push(i);
    }
    return opera;
  }

  /** The vectorizing loop shared by start() and resume(). */
  protected async vectorizeOpera(opera: EntityModelTeiDiv[]): Promise<void> {
    for (const op of opera) {
      if (this.vectorizer.isStopRequested()) {
        this.log.log('Pause requested - halting vectorizing.');
        break;
      }
      try {
        const watch = new StopWatch();
        this.log.log(`will vectorize: `, op);
        const opid = op.id;

        this.vectorizing.currentOpus = { id: opid, head: op.head ?? null, path: op.completePath ?? null };
        this.vectorizing.updatedAt = Date.now();

        // The generated Spring Data REST EntityModelTeiDiv type does not
        // declare the optional author projection, although older server
        // responses may include it. Keep the diagnostic useful without
        // weakening the type of the whole vectorizing pipeline.
        const author = (op as EntityModelTeiDiv & {
          author?: { visualName?: string; displayName?: string };
        }).author;
        this.log.log(`starting vectorizing for ${opid} - ${op.completePath} - ${author?.visualName || author?.displayName || 'Anonymous'} - '${op.head}'`);
        const processed = await this.vectorizer.vectorize(opid);
        this.vectorizing.processedParas += processed || 0;
        this.completedOpusIds.add(opid);
        this.vectorizing.completedOpera++;
        this.vectorizing.updatedAt = Date.now();
        this.log.log(`done vectorizing for ${opid}. took ${watch}`);
      } catch (err: any) {
        this.log.error('will ignore', err);
      }
    }

    this.vectorizing.running = false;
    this.vectorizing.currentOpus = null;
    this.vectorizing.finishedAt = Date.now();
  }
}
