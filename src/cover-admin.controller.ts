import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { EnrichmentAdminService, EnrichmentRunRequest } from './services/enrichment-admin.service';
import { EnrichmentTargetsDto } from './enrichment-admin.controller';

export class CoverRunDto {
  @ApiPropertyOptional({ type: EnrichmentTargetsDto })
  targets?: EnrichmentTargetsDto;

  @ApiPropertyOptional({
    example: false,
    description:
      'Rejected with 400. This endpoint is fill-only by construction: an opus that already has a cover (whatever retrieved it) is never re-rendered, so there is no overwrite switch. Use POST /api/enrichment/run for that.',
  })
  overwrite?: boolean;
}

/**
 * The independent, cover-only admin surface - one enrichment module
 * (see EnrichmentAdminController) exposed on its own REST API, usable
 * end-to-end from the Swagger UI (/api/ui) without assembling an
 * enrichment run request.
 *
 *   POST /api/covers/run            - start a cover-only job (202 + job id)
 *   POST /api/covers/run/dry-run    - the cover candidates, no external call
 *   GET  /api/covers/jobs           - recent jobs, newest first
 *   GET  /api/covers/jobs/:id       - one job's status
 *   POST /api/covers/jobs/:id/cancel - cooperative stop
 *
 * Fill-only, always: an opus that already has a coverUrl is skipped
 * untouched. overwrite is rejected with a 400 - unlike POST
 * /api/enrichment/run, this surface has no overwrite switch at all, so
 * a caller cannot accidentally replace existing covers.
 */
@ApiTags('covers')
@Controller('/api/covers')
export class CoverAdminController {

  constructor(protected admin: EnrichmentAdminService) {}

  @ApiOperation({
    summary: 'Start a cover-only enrichment job (asynchronous - poll GET /api/covers/jobs/:id)',
    description:
      "Fill-only by construction: only opera without a cover are rendered and stored in the MinIO cover cache. Existing covers - however they were retrieved - are never overwritten; the run request's overwrite switch does not exist here and sending it is rejected with a 400.",
  })
  @HttpCode(202)
  @ApiBody({
    type: CoverRunDto,
    examples: {
      allMissing: {
        summary: 'Every coverless opus in the corpus (safe)',
        value: {},
      },
      oneWork: {
        summary: 'One opus, if it has no cover yet',
        value: { targets: { opusPaths: ['opera/alecsandri/lume-ridicata.xml'] } },
      },
      oneAuthor: {
        summary: "One author's coverless opera",
        value: { targets: { authorStrIds: ['vasile-alecsandri'] } },
      },
    },
  })
  @Post('run')
  async run(@Body() dto: CoverRunDto): Promise<Record<string, unknown>> {
    this.refuseOverwrite(dto);
    return this.admin.start(this.toRequest(dto)) as unknown as Promise<Record<string, unknown>>;
  }

  @ApiOperation({
    summary: 'Dry run: the cover candidates this request would process, without any external call',
    description: 'Fill-only mode lists only the coverless opera. Always read-only - nothing is persisted.',
  })
  @HttpCode(200)
  @ApiBody({
    type: CoverRunDto,
    examples: {
      preview: {
        summary: 'Which opera have no cover yet?',
        value: {},
      },
    },
  })
  @Post('run/dry-run')
  async dryRun(@Body() dto: CoverRunDto) {
    this.refuseOverwrite(dto);
    return this.admin.dryRun(this.toRequest(dto));
  }

  @ApiOperation({ summary: 'Recent cover/enrichment jobs, newest first (in memory only - restart forgets them)' })
  @Get('jobs')
  jobs() {
    return this.admin.list();
  }

  @ApiOperation({ summary: 'One cover job: state, counters and the first errors' })
  @Get('jobs/:id')
  job(@Param('id') id: string) {
    return this.admin.get(id);
  }

  @ApiOperation({ summary: 'Ask the running cover job to stop after its current opus (cooperative)' })
  @HttpCode(202)
  @Post('jobs/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.admin.cancel(id);
  }

  /**
   * The one hard rule of this surface: there is no overwrite switch. A
   * body that carries one is refused before anything is started, so a
   * cover-only call can never replace an existing cover.
   */
  private refuseOverwrite(dto: CoverRunDto): void {
    if (dto?.overwrite === true) {
      throw new BadRequestException('the covers API is fill-only by construction: existing covers are never overwritten - use POST /api/enrichment/run with steps ["cover"] and overwrite true for that');
    }
  }

  private toRequest(dto: CoverRunDto): EnrichmentRunRequest {
    return {
      steps: ['cover'],
      targets: dto?.targets,
      overwrite: false,
    };
  }
}
