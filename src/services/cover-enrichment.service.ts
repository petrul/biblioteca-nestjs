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
};

/** Slow, best-effort work-cover generation. Never runs on a reader request. */
@Injectable()
export class CoverEnrichmentService {
  private readonly log = new Logger(CoverEnrichmentService.name);
  private readonly pending = new Set<string>();
  private readonly queue: CoverCandidate[] = [];
  private active = 0;
  private static readonly MAX_CONCURRENT = 2;
  private readonly minio?: MinioClient;
  private bucket = 'biblioteca';

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
      } catch (error: any) {
        this.log.warn(`cover cache disabled: invalid MINIO_URL/MINIO_CREDS (${error?.message || 'invalid configuration'})`);
      }
    } else {
      this.log.warn('cover enrichment disabled: MinIO cover-cache credentials are not configured');
    }
  }

  /**
   * Fill-only by default: an opus that already has a coverUrl is left
   * alone. opts.force - the manual admin runs' explicit overwrite switch,
   * never an automatic caller - is the only way to re-render an existing
   * cover.
   */
  enqueue(candidate: CoverCandidate, opts: { force?: boolean } = {}): void {
    if (!this.minio || !candidate.path) return;
    if (this.pending.has(candidate.path)) return;
    if (!opts.force && candidate.coverUrl) return;
    this.pending.add(candidate.path);
    this.queue.push(candidate);
    this.drain();
  }

  private drain(): void {
    while (this.active < CoverEnrichmentService.MAX_CONCURRENT && this.queue.length) {
      const candidate = this.queue.shift()!;
      this.active++;
      void this.generate(candidate).finally(() => {
        this.pending.delete(candidate.path!);
        this.active--;
        this.drain();
      });
    }
  }

  private async generate(candidate: CoverCandidate): Promise<void> {
    const started = Date.now();
    this.log.log(`cover candidate ${candidate.path}`);
    try {
      const response = await fetch(`${this.conf.coversApiUrl.replace(/\/$/, '')}/api/cover`, {
        method: 'POST',
        headers: { Accept: 'image/png', 'Content-Type': 'application/json', 'X-Biblioteca-Work-Id': candidate.path! },
        body: JSON.stringify({
          title: candidate.title,
          author: candidate.author,
          layout: 'archival_monograph',
          foilEffect: 'none',
          hardcover: false,
          format: 'png',
          pixelRatio: 2,
          theme: { paletteId: 'archival_alabaster', showBarcode: false },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`cover renderer HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      const key = this.objectKey(candidate.path!);
      await this.minio!.putObject(this.bucket, key, body, body.length, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      const url = this.publicUrl(key);
      await this.biblioteca.persistEnrichment({ opusId: candidate.id, coverUrl: url });
      this.log.log(`generated cover ${candidate.path} in ${this.elapsed(started)}`);
    } catch (error: any) {
      this.log.warn(`cover generation failed for ${candidate.path} after ${this.elapsed(started)}: ${error?.message || error}`);
    }
  }

  private objectKey(path: string): string {
    const safe = path.split('/').map(part => encodeURIComponent(part)).join('/');
    return `covers/${safe}-${createHash('sha256').update(path).digest('hex').slice(0, 12)}.png`;
  }

  private publicUrl(key: string): string {
    const base = (this.conf.minioUrl || '').replace(/\/$/, '');
    return `${base}/${key}`;
  }

  private elapsed(started: number): string {
    const seconds = Math.round((Date.now() - started) / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
}
