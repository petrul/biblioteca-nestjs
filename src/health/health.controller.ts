import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheckService, HealthCheck, MemoryHealthIndicator } from '@nestjs/terminus';
import { PROVIDER_CONF, VectorizerConfiguration } from '../configuration';
import { UpstreamHealthIndicator } from './upstream-health.indicator';

/**
 * GET /health - the nestjs counterpart of biblioteca-server's Spring Boot
 * Actuator (/actuator/health): standard aggregated health for monitoring/
 * watchdogs, distinct from GET /api/status and GET /api/vectorizing (this
 * app's own domain status, unaffected by this addition). Checks the two
 * dependencies this worker cannot function without - the vector store and
 * biblioteca-server - plus a heap sanity check.
 */
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private memory: MemoryHealthIndicator,
    private upstream: UpstreamHealthIndicator,
    @Inject(PROVIDER_CONF) private conf: VectorizerConfiguration,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
      () => this.upstream.checkUrl('vector_store', `${this.conf.vectorStoreUrl}/collections`),
      () => this.upstream.checkUrl('biblioteca_server', `${this.conf.bibliotecaUrl}/api/info`),
    ]);
  }
}
