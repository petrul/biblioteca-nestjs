import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Client as MinioClient } from 'minio';
import { BibliotecaClient } from './biblioteca_client.service';
import { AppConfService, PROVIDER_CONF } from '../configuration';

type CoverCandidate = {
  id: number;
  path?: string;
  title: string;
  author: string;
  coverUrl?: string;
  /**
   * Art for the cover's portrait/art layer, retrieved by the enrichment
   * pass that orders the cover (see EnrichmentService): the opus's own
   * Wikipedia/Wikimedia image, else its author's portrait. Absent when
   * no graphics were retrieved - the renderer then falls back to its
   * text-only studio default. Just a URL, like every enrichment image:
   * the renderer downloads it itself at render time.
   */
  artUrl?: string;
};

/** A stored cover and the request JSON it was rendered from. */
export type GeneratedCover = { coverUrl: string; request: Record<string, unknown> };

/**
 * The imprint printed on every generated cover - CoverRenderRequest's own
 * publisher/date/pubPlace/series fields, set explicitly rather than left
 * to the renderer's defaults.
 */
export const COVER_IMPRINT = {
  publisher: 'Ediții Scriptorium',
  date: '2026',
  pubPlace: 'București',
  series: 'Scriptorium Classique',
} as const;

/** Slow, best-effort work-cover generation. Never runs on a reader request. */
@Injectable()
export class CoverEnrichmentService {
  private readonly log = new Logger("cover-enrichment");
  private readonly pending = new Set<string>();
  private readonly queue: { candidate: CoverCandidate; force: boolean; resolve: (ok: boolean) => void }[] = [];
  private active = 0;
  private static readonly MAX_CONCURRENT = 2;
  private readonly minio?: MinioClient;
  private bucket = 'biblioteca';

  /**
   * A random layout archetype and palette per cover, discovered from the
   * renderer's own /api/cover/meta so the id lists are never duplicated
   * here (the covers service is their canonical home). Cached after the
   * first successful fetch; any failure (renderer down, odd response in
   * a test) falls back to one fixed, known-good combination - a themed
   * cover is always better than none, but never at the cost of ordering
   * one at all.
   */
  // Excluded from the random pool below, not from the covers service's own
  // id list - 'storybook_whimsy' ("The Whimsical Storybook") stays a valid,
  // selectable layout everywhere else, just never auto-picked for a
  // batch-generated cover.
  private static readonly EXCLUDED_RANDOM_LAYOUTS = ['storybook_whimsy'];
  // The one layout drawn without any picture: a work with no art of its
  // own and an author with no portrait is only ever given this one.
  static readonly NO_ART_LAYOUT = 'pure_typographic';
  private coverMeta?: { layouts: string[]; palettes: string[] };
  private async randomTheme(hasArt = true): Promise<{ layout: string; paletteId: string }> {
    if (!this.coverMeta) {
      try {
        const resp = await fetch(`${this.conf.coversApiUrl.replace(/\/$/, '')}/api/cover/meta`);
        if (resp.ok) {
          const meta = await resp.json();
          const ids = (arr: unknown) =>
            (Array.isArray(arr) ? arr : []).map((e: any) => e?.id ?? e).filter((id: any) => typeof id === 'string');
          const layouts = ids(meta.layouts).filter(
            (id: string) => !CoverEnrichmentService.EXCLUDED_RANDOM_LAYOUTS.includes(id),
          );
          this.coverMeta = { layouts, palettes: ids(meta.palettes) };
        }
      } catch (error: any) {
        this.log.error(`Covers service unavailable at ${this.conf.coversApiUrl}: ${error?.message || error}`);
        // best-effort discovery - the defaults below still order a cover,
        // but the dependency failure must remain visible in the log.
      }
    }
    const pick = (ids: string[] | undefined, fallback: string) =>
      ids && ids.length ? ids[Math.floor(Math.random() * ids.length)] : fallback;
    const layout = hasArt ? pick(this.coverMeta?.layouts, 'archival_monograph') : CoverEnrichmentService.NO_ART_LAYOUT;
    return { layout, paletteId: pick(this.coverMeta?.palettes, 'archival_alabaster') };
  }

  constructor(
    private readonly biblioteca: BibliotecaClient,
    @Inject(PROVIDER_CONF) private readonly conf: AppConfService,
  ) {
    if (conf.minioUrl && conf.minioCred) {
      try {
        const endpoint = new URL(conf.minioUrl);
        this.bucket = endpoint.pathname.replace(/^\/+|\/+$/g, '') || 'biblioteca';
        const separator = conf.minioCred.indexOf(':');
        if (separator <= 0 || separator === conf.minioCred.length - 1) throw new Error('MINIO_CREDS must be access-key:secret-key');
        const accessKey = conf.minioCred.slice(0, separator);
        const secretKey = conf.minioCred.slice(separator + 1);
        this.minio = new MinioClient({
          endPoint: endpoint.hostname,
          port: Number(endpoint.port) || (endpoint.protocol === 'https:' ? 443 : 80),
          useSSL: endpoint.protocol === 'https:',
          accessKey,
          secretKey,
        });
        this.log.log(`cover cache enabled (bucket ${this.bucket}, prefix covers/)`);
        if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
          void this.verifyMinio();
          void this.verifyCoversApi();
        }
      } catch (error: any) {
        this.log.warn(`cover cache disabled: invalid MINIO_URL/MINIO_CREDS (${error?.message || 'invalid configuration'})`);
      }
    } else {
      this.log.warn('cover enrichment disabled: MinIO cover-cache credentials are not configured');
    }
  }

  private async verifyMinio(): Promise<void> {
    const endpoint = this.conf.minioUrl?.replace(/\/+$|\?.*$/g, '') || 'configured endpoint';
    try {
      const reachable = await Promise.race([
        this.minio!.bucketExists(this.bucket),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout after 10s')), 10_000)),
      ]);
      if (!reachable) {
        this.log.error(`MINIO unavailable: bucket \`${this.bucket}\` does not exist at ${endpoint}`);
        return;
      }
      this.log.log(`MINIO cover cache reachable at ${endpoint} (bucket ${this.bucket})`);
    } catch (error: any) {
      this.log.error(`MINIO unavailable at ${endpoint} (bucket ${this.bucket}): ${error?.message || error}`);
    }
  }

  private async verifyCoversApi(): Promise<void> {
    const endpoint = this.conf.coversApiUrl.replace(/\/+$/, '');
    try {
      const response = await fetch(`${endpoint}/api/cover/meta`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        this.log.error(`Covers service unavailable at ${endpoint}: HTTP ${response.status}`);
        return;
      }
      this.log.log(`Covers service reachable at ${endpoint}`);
    } catch (error: any) {
      this.log.error(`Covers service unavailable at ${endpoint}: ${error?.message || error}`);
    }
  }

  /** Whether enqueue() can accept work at all (MinIO configured). */
  get accepting(): boolean {
    return !!this.minio;
  }

  /**
   * Fill-only by default: an opus whose stored coverUrl verifies in MinIO
   * (present AND image bytes) is left alone. opts.force - the manual admin
   * runs' explicit overwrite switch, never an automatic caller - is the
   * only way to re-render a verified cover.
   */
  /**
   * @returns whether the cover actually got generated and stored - false
   * both for an early skip (fill-only already-covered, no MinIO, no path)
   * and for a real render/upload failure. Callers that only fire-and-
   * forget (the Kafka listener, dailySweep) simply never await this;
   * EnrichmentAdminService's job counters are the one caller that does,
   * so a long-running admin run can actually report progress instead of
   * candidates sitting at processed:0 forever while covers render in
   * the background.
   */
  enqueue(candidate: CoverCandidate, opts: { force?: boolean } = {}): Promise<boolean> {
    if (!candidate.path) {
      this.log.error(`cover cannot be stored: candidate has no stable path (opus ${candidate.id})`);
      return Promise.resolve(false);
    }
    if (!this.minio) {
      const endpoint = this.conf.minioUrl?.replace(/\/+$/,'') || 'not configured';
      this.log.error(`MINIO unavailable; cannot store cover for ${candidate.path} at ${endpoint} (bucket ${this.bucket})`);
      return Promise.resolve(false);
    }
    if (this.pending.has(candidate.path)) {
      this.log.log(`cover skipped for ${candidate.path}: already queued`);
      return Promise.resolve(false);
    }
    this.pending.add(candidate.path);
    return (async () => {
      let force = !!opts.force;
      if (!force && candidate.coverUrl) {
        if (await this.coverExists(candidate.coverUrl)) {
          this.log.log(`cover skipped for ${candidate.path}: already has ${candidate.coverUrl}`);
          this.pending.delete(candidate.path!);
          return false;
        }
        // The server is fill-only: a new cover only replaces the dead stored URL if asked to.
        force = true;
      }
      return new Promise<boolean>(resolve => {
        this.queue.push({ candidate, force, resolve });
        this.drain();
      });
    })();
  }

  /**
   * Whether a stored coverUrl can be left alone without re-rendering.
   * A URL into our own cache must verify against MinIO: the object must
   * exist AND really carry image bytes - buckets have held JSON error
   * bodies stored under .png keys by a misbehaving renderer, and objects
   * deleted behind the database's back must re-render or fill-only would
   * skip that opus forever. Any other URL (a cover set by hand elsewhere)
   * is trusted as-is.
   */
  private async coverExists(coverUrl: string): Promise<boolean> {
    const key = this.ownObjectKey(coverUrl);
    if (!key) return true;
    try {
      const head = await this.objectPrefix(key);
      if (CoverEnrichmentService.looksLikeImage(head)) return true;
      this.log.warn(`stored cover ${coverUrl} is not an image (starts with ${JSON.stringify(head.toString('utf8').slice(0, 40))}); re-rendering`);
      return false;
    } catch (error: any) {
      if (error?.code === 'NotFound' || error?.code === 'NoSuchKey') {
        this.log.log(`stored cover ${coverUrl} is missing from MinIO; re-rendering`);
        return false;
      }
      // MinIO hiccup: keep fill-only semantics rather than re-render blindly
      this.log.warn(`cannot verify stored cover ${coverUrl}: ${error?.message || error}`);
      return true;
    }
  }

  /**
   * Whether a stored coverUrl can be trusted as-is. False with no stored
   * URL, or when the URL is ours and the MinIO object behind it is missing
   * or not an image; true when the object verifies, when the URL is not
   * one of ours (hand-set elsewhere - trusted by coverExists), and when
   * MinIO is not configured at all (nothing to verify against - the
   * pre-cache behavior). Callers that skip cover generation on the
   * database's coverUrl alone - the work-enrichment Kafka listener, the
   * manual admin run's skip arithmetic - must ask here instead of trusting
   * the database field.
   */
  async hasUsableCover(coverUrl: string | undefined): Promise<boolean> {
    if (!coverUrl) return false;
    if (!this.minio) return true;
    return this.coverExists(coverUrl);
  }

  /** First bytes of a stored object - enough for an image-signature check. */
  private async objectPrefix(key: string, length = 12): Promise<Buffer> {
    const stream = await this.minio!.getPartialObject(this.bucket, key, 0, length);
    const chunks: Buffer[] = [];
    for await (const chunk of stream as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /** PNG/JPEG/GIF/WEBP/BMP/SVG magic - anything else is not a cover image. */
  private static looksLikeImage(head: Buffer): boolean {
    if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true; // PNG
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true; // JPEG
    if (head.subarray(0, 4).toString('latin1').startsWith('GIF8')) return true;
    if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return true;
    if (head.length >= 2 && head[0] === 0x42 && head[1] === 0x4d) return true; // BMP
    return head.toString('utf8').trimStart().startsWith('<'); // SVG (<?xml / <svg)
  }

  /** The cache object key behind one of our own cover URLs, else undefined. */
  private ownObjectKey(coverUrl: string): string | undefined {
    for (const base of [this.conf.minioPublicUrl, this.conf.minioUrl]) {
      const prefix = (base || '').replace(/\/+$/, '') + '/';
      if (base && coverUrl.startsWith(prefix)) {
        const key = coverUrl.slice(prefix.length).split('?')[0];
        // verbatim: objectKey() stores the percent-encoded form as the key
        return key.startsWith('covers/') ? key : undefined;
      }
    }
    return undefined;
  }

  private drain(): void {
    while (this.active < CoverEnrichmentService.MAX_CONCURRENT && this.queue.length) {
      const { candidate, force, resolve } = this.queue.shift()!;
      this.active++;
      void this.generate(candidate, force).then(result => resolve(result !== null)).finally(() => {
        this.pending.delete(candidate.path!);
        this.active--;
        this.drain();
      });
    }
  }

  /** The POST /api/cover body for one candidate - public so tests can pin it. */
  coverRequest(candidate: CoverCandidate, theme: { layout: string; paletteId: string }): Record<string, unknown> {
    return {
      title: candidate.title,
      author: candidate.author,
      ...COVER_IMPRINT,
      // The renderer's coverArtUrl: same-origin path, data URL or
      // remote https URL (auto-proxied, see biblioteca-covers'
      // coverRequest.ts) - Wikipedia/Wikimedia URLs qualify as-is.
      ...(candidate.artUrl ? { coverArtUrl: candidate.artUrl } : {}),
      layout: theme.layout,
      foilEffect: 'none',
      // Explicit 12px spine rather than relying on the renderer's
      // boolean-hardcover defaults (biblioteca-covers coverRequest.ts).
      hardcover: {
        enabled: true,
        spineVisible: true,
        spineWidthPx: 12,
        textureStyle: 'buckram_cloth',
        sheenIntensity: 0.25,
        creaseDepth: 0.4,
        showPageEdge: true,
        embossedTitle: true,
      },
      format: 'png',
      pixelRatio: 2,
      theme: { paletteId: theme.paletteId, showBarcode: false },
    };
  }

  /**
   * Renders one cover right now and waits for it - the reader's admin
   * "generate cover" (POST /api/covers/work). Always replaces the work's
   * current cover; refuses while the same work is already being rendered.
   */
  /**
   * Renders one cover right now and waits for it - the reader's admin
   * "generate cover" (POST /api/covers/work). Always replaces the work's
   * current cover; refuses while the same work is already being rendered.
   * An admin-supplied request (the reader's editable JSON) is used verbatim,
   * skipping the random theme.
   */
  async generateNow(candidate: CoverCandidate, request?: Record<string, unknown>): Promise<GeneratedCover> {
    if (!candidate.path) throw new Error(`opus ${candidate.id} has no stable path`);
    if (!this.minio) throw new Error('MinIO cover cache not configured');
    if (this.pending.has(candidate.path)) throw new Error(`a cover for ${candidate.path} is already being rendered`);
    this.pending.add(candidate.path);
    try {
      const result = await this.generate(candidate, true, request);
      if (!result) throw new Error(`cover generation failed for ${candidate.path} (see the nestjs log)`);
      return result;
    } finally {
      this.pending.delete(candidate.path);
    }
  }

  /**
   * A fresh random cover request for a candidate, WITHOUT rendering it -
   * the reader admin's "New random JSON" button fills its editor with this.
   */
  async randomRequest(candidate: CoverCandidate): Promise<Record<string, unknown>> {
    return this.coverRequest(candidate, await this.randomTheme(!!candidate.artUrl));
  }

  /**
   * The request JSON a cover was rendered from, stored next to its PNG by
   * generate(); null for covers rendered before that was recorded, or not
   * ours (a URL outside the cover cache).
   */
  async storedRequest(coverUrl: string | undefined): Promise<Record<string, unknown> | null> {
    const key = coverUrl ? this.ownObjectKey(coverUrl) : undefined;
    if (!key || !this.minio) return null;
    try {
      const stream = await this.minio.getObject(this.bucket, CoverEnrichmentService.requestKey(key));
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error: any) {
      if (error?.code === 'NoSuchKey' || error?.code === 'NotFound') return null;
      throw error;
    }
  }

  /** The object key of a cover's request JSON: the PNG's key with .json. */
  static requestKey(pngKey: string): string {
    return pngKey.replace(/\.png$/, '') + '.json';
  }

  private async generate(candidate: CoverCandidate, replace = false, requestOverride?: Record<string, unknown>): Promise<GeneratedCover | null> {
    const started = Date.now();
    this.log.log(`cover candidate ${candidate.path}`);
    try {
      // Random layout + palette per cover (see randomTheme) - the point
      // of the whole cover feature is a varied shelf, not one house
      // design repeated two thousand times. An admin-supplied request
      // (the reader's editable JSON) overrides the theme entirely.
      // Without any art (neither the work's nor its author's) only the
      // typographic layout - the others are built around a picture.
      const theme = requestOverride ? null : await this.randomTheme(!!candidate.artUrl);
      const request = requestOverride ?? this.coverRequest(candidate, theme!);
      // The exact JSON sent to biblioteca-covers, one line per cover.
      this.log.log(`cover request ${candidate.path}: ${requestOverride ? '(admin-supplied) ' : ''}${JSON.stringify(request)}`);
      const response = await fetch(`${this.conf.coversApiUrl.replace(/\/$/, '')}/api/cover`, {
        method: 'POST',
        headers: { Accept: 'image/png', 'Content-Type': 'application/json', 'X-Biblioteca-Work-Id': candidate.path! },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`cover renderer HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      // A 200 with a non-image body (an error document, a JSON stub) must
      // never reach the cover cache: hasUsableCover would keep re-rendering
      // it forever and the reader would keep falling back - refuse at the
      // source. See the stored-cover poisoning the verification check exists
      // to catch.
      if (!CoverEnrichmentService.looksLikeImage(body.subarray(0, 12))) {
        throw new Error(`cover renderer returned a non-image body (starts with ${JSON.stringify(body.subarray(0, 40).toString('utf8').slice(0, 40))})`);
      }
      const key = this.objectKey(candidate.path!, body);
      try {
        await this.minio!.putObject(this.bucket, key, body, body.length, {
          'Content-Type': 'image/png',
          // Content-hashed key (objectKey below) already makes a real
          // change land at a new URL, so a long max-age is still safe -
          // but covers are being actively iterated on right now, far more
          // than a typical "renders once, basically final" asset, and a
          // year is needlessly long for how often that happens today. An
          // hour still caches meaningfully within one browsing session
          // without holding on to a now-orphaned render for the long haul.
          'Cache-Control': 'public, max-age=3600',
        });
      } catch (error: any) {
        const endpoint = this.conf.minioUrl?.replace(/\/+$|\?.*$/g, '') || 'configured endpoint';
        this.log.error(`MINIO unavailable while storing cover at ${endpoint} (bucket ${this.bucket}, key ${key}): ${error?.message || error}`);
        throw error;
      }
      // The request it was rendered from, next to the PNG: what the reader's
      // admin section shows for the current cover (storedRequest).
      const requestJson = Buffer.from(JSON.stringify(request, null, 2));
      try {
        await this.minio!.putObject(this.bucket, CoverEnrichmentService.requestKey(key), requestJson, requestJson.length, {
          'Content-Type': 'application/json; charset=utf-8',
        });
      } catch (error: any) {
        // The cover itself is stored; a missing request record only hides it from the admin view.
        this.log.warn(`cover request JSON not stored for ${candidate.path}: ${error?.message || error}`);
      }
      const url = this.publicUrl(key);
      // A forced render must become the work's cover (server-side fill-only otherwise).
      await this.biblioteca.persistEnrichment({ opusId: candidate.id, coverUrl: url, ...(replace ? { replaceCover: true } : {}) });
      this.log.log(`generated cover ${candidate.path} in ${this.elapsed(started)}`);
      return { coverUrl: url, request };
    } catch (error: any) {
      this.log.warn(`cover generation failed for ${candidate.path} after ${this.elapsed(started)}: ${error?.message || error}`);
      return null;
    }
  }

  /**
   * Hashes the rendered BYTES, not the opus path - a path-derived key
   * means every re-render overwrites the exact same URL, which is wrong
   * for any non-zero cache lifetime: a browser, CDN or any intermediate
   * proxy that already cached the old bytes there has no reason to ask
   * again until that lifetime is up (observed: "shows cached image no
   * matter what, even after clearing site data" on a work whose cover
   * had genuinely just been regenerated, well within putObject's own
   * max-age above). A content hash makes every real change a new URL
   * instead, which is correct regardless of how aggressive that caching
   * is - the trade-off is that old keys go orphaned in MinIO rather than
   * being reused, a storage-cost concern, not a correctness one.
   */
  private objectKey(path: string, body: Buffer): string {
    const safe = path.split('/').map(part => encodeURIComponent(part)).join('/');
    return `covers/${safe}-${createHash('sha256').update(body).digest('hex').slice(0, 12)}.png`;
  }

  private publicUrl(key: string): string {
    // The real-user-browser-facing address - deliberately NOT minioUrl
    // (that one is the internal direct host:port the S3 client itself
    // connects on; a reverse-proxied public domain is one more thing
    // that can silently break writes, so uploads never depend on it).
    const base = (this.conf.minioPublicUrl || this.conf.minioUrl || '').replace(/\/$/, '');
    return `${base}/${key}`;
  }

  private elapsed(started: number): string {
    const seconds = Math.round((Date.now() - started) / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
}
