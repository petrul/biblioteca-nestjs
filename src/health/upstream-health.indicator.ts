import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';

/**
 * Generic "can I reach this URL" health indicator - used for the two real
 * dependencies this worker cannot do anything useful without: the vector
 * store (VECTORSTORE_URL) and biblioteca-server itself (BIBLIOTECA_EXTERNAL_URL,
 * the same-network one, not the public URL - see HealthController). Plain
 * fetch with a short timeout rather than @nestjs/axios's HttpHealthIndicator,
 * matching every other upstream call in this codebase (QdrantCollection,
 * BibliotecaClient) - no new HTTP client dependency for one check.
 */
@Injectable()
export class UpstreamHealthIndicator extends HealthIndicator {
  async checkUrl(key: string, url: string, timeoutMs = 3000): Promise<HealthIndicatorResult> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      const result = this.getStatus(key, res.ok, { url, httpStatus: res.status });
      if (!res.ok) throw new HealthCheckError(`${key} returned HTTP ${res.status}`, result);
      return result;
    } catch (err: any) {
      if (err instanceof HealthCheckError) throw err;
      const result = this.getStatus(key, false, { url, message: err?.message ?? String(err) });
      throw new HealthCheckError(`${key} is unreachable`, result);
    }
  }
}
