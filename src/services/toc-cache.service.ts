import { Injectable, Logger } from '@nestjs/common';
import { BibliotecaClient } from './biblioteca_client.service';

/** What one warming pass did; also the `cache` step's counters. */
export interface TocWarmResult {
  /** Works without a cached TOC when the pass started. */
  missing: number;
  built: number;
  failed: number;
  /** Total works on the server. */
  works: number;
  errors: string[];
}

export interface TocWarmOptions {
  /** Checked between works: a cancelled admin run stops cooperatively. */
  shouldStop?: () => boolean;
  /** Pause between two builds, so a pass never competes with readers. */
  pauseMs?: number;
  /** Safety cap for one pass. */
  maxBuilds?: number;
}

/**
 * The `cache` enrichment module: makes sure every work's table of contents
 * is in biblioteca-server's disk cache, so no reader ever waits for one to
 * be built (the Bible's took 12-15 s - see biblioteca-server's
 * docs/caching-plan.md). The server builds a work's TOC at import already;
 * this is the backstop for works imported before that, or whose build
 * failed.
 *
 * Asks the server which works lack a TOC and builds them one at a time,
 * with a pause between builds. Never deletes anything.
 */
@Injectable()
export class TocCacheService {
  private readonly log = new Logger('toc-cache');
  private static readonly PAGE = 100;
  private static readonly MAX_ERRORS = 20;

  constructor(private readonly client: BibliotecaClient) {}

  /** How many works lack a TOC - the dry run, no build. */
  async missing(): Promise<{ missing: number[]; works: number }> {
    return this.client.missingTocs(10000);
  }

  async warmMissing(opts: TocWarmOptions = {}): Promise<TocWarmResult> {
    const pauseMs = opts.pauseMs ?? 2000;
    const maxBuilds = opts.maxBuilds ?? 100000;
    const result: TocWarmResult = { missing: 0, built: 0, failed: 0, works: 0, errors: [] };
    // A work whose build failed is not asked for again in this pass;
    // otherwise it would head every page of missing ids forever.
    const failed = new Set<number>();
    let first = true;
    while (result.built + result.failed < maxBuilds) {
      if (opts.shouldStop?.()) break;
      const page = await this.client.missingTocs(TocCacheService.PAGE + failed.size);
      if (first) {
        result.missing = page.missing.length;
        result.works = page.works;
        first = false;
        if (page.missing.length) this.log.log(`${page.missing.length}${page.missing.length >= TocCacheService.PAGE ? '+' : ''} of ${page.works} works have no cached TOC - building`);
      }
      const todo = page.missing.filter(id => !failed.has(id));
      if (!todo.length) break;
      for (const id of todo) {
        if (opts.shouldStop?.() || result.built + result.failed >= maxBuilds) break;
        try {
          const built = await this.client.buildToc(id);
          result.built++;
          this.log.log(`built TOC of work ${id}: ${built.divisions} divisions in ${built.millis} ms`);
        } catch (e: any) {
          result.failed++;
          failed.add(id);
          const message = `TOC of work ${id}: ${e?.message ?? e}`;
          if (result.errors.length < TocCacheService.MAX_ERRORS) result.errors.push(message);
          this.log.warn(`failed to build ${message}`);
        }
        if (pauseMs > 0) await new Promise(resolve => setTimeout(resolve, pauseMs));
      }
    }
    if (result.built || result.failed) {
      this.log.log(`TOC cache pass done: ${result.built} built, ${result.failed} failed, ${result.works} works`);
    }
    return result;
  }
}
