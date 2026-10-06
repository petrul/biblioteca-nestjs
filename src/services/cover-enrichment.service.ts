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

/** Slow, best-effort work-cover generation. Never runs on a reader request. */
@Injectable()
export class CoverEnrichmentService {
  private readonly log = new Logger("cover-enrichment");
  private readonly pending = new Set<string>();
  private readonly queue: { candidate: CoverCandidate; resolve: (ok: boolean) => void }[] = [];
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
  private coverMeta?: { layouts: string[]; palettes: string[] };
  private async randomTheme(): Promise<{ layout: string; paletteId: string }> {
    if (!this.coverMeta) {
      try {
        const resp = await fetch(`${this.conf.coversApiUrl.replace(/\/$/, '')}/api/cover/meta`);
        if (resp.ok) {
          const meta = await resp.json();
          const ids = (arr: unknown) =>
            (Array.isArray(arr) ? arr : []).map((e: any) => e?.id ?? e).filter((id: any) => typeof id === 'string');
          this.coverMeta = { layouts: ids(meta.layouts), palettes: ids(meta.palettes) };
        }
      } catch (error: any) {
        this.log.error(`Covers service unavailable at ${this.conf.coversApiUrl}: ${error?.message || error}`);
        // best-effort discovery - the defaults below still order a cover,
        // but the dependency failure must remain visible in the log.
      }
    }
    const pick = (ids: string[] | undefined, fallback: string) =>
      ids && ids.length ? ids[Math.floor(Math.random() * ids.length)] : fallback;
    return { layout: pick(this.coverMeta?.layouts, 'archival_monograph'), paletteId: pick(this.coverMeta?.palettes, 'archival_alabaster') };
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
   * Fill-only by default: an opus that already has a coverUrl is left
   * alone. opts.force - the manual admin runs' explicit overwrite switch,
   * never an automatic caller - is the only way to re-render an existing
   * cover.
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
    if (this.pending.has(candidate.path)) return Promise.resolve(false);
    if (!opts.force && candidate.coverUrl) return Promise.resolve(false);
    this.pending.add(candidate.path);
    return new Promise<boolean>(resolve => {
      this.queue.push({ candidate, resolve });
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < CoverEnrichmentService.MAX_CONCURRENT && this.queue.length) {
      const { candidate, resolve } = this.queue.shift()!;
      this.active++;
      void this.generate(candidate).then(resolve).finally(() => {
        this.pending.delete(candidate.path!);
        this.active--;
        this.drain();
      });
    }
  }

  private async generate(candidate: CoverCandidate): Promise<boolean> {
    const started = Date.now();
    this.log.log(`cover candidate ${candidate.path}`);
    try {
      // Random layout + palette per cover (see randomTheme) - the point
      // of the whole cover feature is a varied shelf, not one house
      // design repeated two thousand times.
      const theme = await this.randomTheme();
      const response = await fetch(`${this.conf.coversApiUrl.replace(/\/$/, '')}/api/cover`, {
        method: 'POST',
        headers: { Accept: 'image/png', 'Content-Type': 'application/json', 'X-Biblioteca-Work-Id': candidate.path! },
        body: JSON.stringify({
          title: candidate.title,
          author: candidate.author,
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
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`cover renderer HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      const key = this.objectKey(candidate.path!);
      try {
        await this.minio!.putObject(this.bucket, key, body, body.length, {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
      } catch (error: any) {
        const endpoint = this.conf.minioUrl?.replace(/\/+$|\?.*$/g, '') || 'configured endpoint';
        this.log.error(`MINIO unavailable while storing cover at ${endpoint} (bucket ${this.bucket}, key ${key}): ${error?.message || error}`);
        throw error;
      }
      const url = this.publicUrl(key);
      await this.biblioteca.persistEnrichment({ opusId: candidate.id, coverUrl: url });
      this.log.log(`generated cover ${candidate.path} in ${this.elapsed(started)}`);
      return true;
    } catch (error: any) {
      this.log.warn(`cover generation failed for ${candidate.path} after ${this.elapsed(started)}: ${error?.message || error}`);
      return false;
    }
  }

  private objectKey(path: string): string {
    const safe = path.split('/').map(part => encodeURIComponent(part)).join('/');
    return `covers/${safe}-${createHash('sha256').update(path).digest('hex').slice(0, 12)}.png`;
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
