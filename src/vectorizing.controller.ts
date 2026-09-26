import { Controller, Get, Post, Query } from '@nestjs/common';
import { VectorizingJobService, VectorizingStatus } from './services/vectorizing_job.service';

/**
 * The single bulk vectorizing job as one REST resource:
 *
 *   GET  /api/vectorizing        - status: state, progress, current opus
 *   POST /api/vectorizing/start  - fresh full run (?shuffle=true for random order)
 *   POST /api/vectorizing/pause  - halt after the current batch
 *   POST /api/vectorizing/resume - continue from where pause halted
 *
 * GET /api/status embeds the same VectorizingStatus alongside the other
 * app-wide flags, configs and information it serves.
 */
@Controller('/api/vectorizing')
export class VectorizingController {

  constructor(protected job: VectorizingJobService) {}

  @Get()
  status(): VectorizingStatus {
    return this.job.status();
  }

  /** Starts a fresh full run; the response arrives when it completes. */
  @Post('start')
  async start(@Query('shuffle') shuffle: boolean = false): Promise<VectorizingStatus> {
    return await this.job.start(shuffle);
  }

  /** Halts the running job after its current batch; resume continues from there. */
  @Post('pause')
  pause(): { paused: boolean } {
    return this.job.pause();
  }

  /** Continues the most recent run from where it was paused. */
  @Post('resume')
  async resume(): Promise<{ resumed: boolean; reason?: string; remaining?: number }> {
    return await this.job.resume();
  }
}
