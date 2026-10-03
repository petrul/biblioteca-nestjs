import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { EnrichmentAdminService, EnrichmentRunRequest } from './services/enrichment-admin.service';
import { ENRICHMENT_MODULES, ENRICHMENT_STEP_IDS, EnrichmentStep } from './services/enrichment-modules';

export class EnrichmentTargetsDto {
  @ApiPropertyOptional({
    example: ['vasile-alecsandri'],
    description: 'Restrict the run to these author strIds. Omit entirely (or leave empty) to cover all authors.',
  })
  authorStrIds?: string[];

  @ApiPropertyOptional({
    example: ['opera/alecsandri/lume-ridicata.xml'],
    description: 'Restrict the run to these opus paths (as in the Kafka import events). Omit entirely to cover all works. Required for the vectorize step.',
  })
  opusPaths?: string[];
}

export class EnrichmentRunDto {
  @ApiProperty({
    enum: ENRICHMENT_STEP_IDS,
    isArray: true,
    example: ['author', 'work'],
    description: 'Which enrichment modules to run - GET /api/enrichment/modules lists and explains them.',
  })
  steps: EnrichmentStep[];

  @ApiPropertyOptional({ type: EnrichmentTargetsDto })
  targets?: EnrichmentTargetsDto;

  @ApiPropertyOptional({
    example: false,
    description: 'Default (false or omitted): every step only enriches what is not enriched yet - existing data is never touched. True: re-enrich already-enriched entities and replace their data (rejected for the vectorize step). Never sticky - the next request starts from false again.',
  })
  overwrite?: boolean;
}

/**
 * The manual enrichment admin surface - the explicit way to retrigger
 * enrichment integrally or partially, usable end-to-end from the Swagger
 * UI (/api/ui). Fill-only by default on every route; overwrite is the
 * one explicit, per-request, never-sticky switch.
 *
 *   GET  /api/enrichment/modules      - the module catalog (what is available)
 *   GET  /api/enrichment/jobs        - recent jobs, newest first
 *   GET  /api/enrichment/jobs/:id     - one job's status
 *   POST /api/enrichment/run         - start a job (202 + job id)
 *   POST /api/enrichment/run/dry-run - the candidates, no external call
 *   POST /api/enrichment/jobs/:id/cancel - cooperative stop
 *   GET  /api/enrichment/author/:strId - which author fields are present
 *   GET  /api/enrichment/work?path=  - which work fields are present
 *
 * Nothing here touches the vector store's destructive operations: those
 * stay on their own manual-only endpoints (see "Vectors are precious").
 */
@ApiTags('enrichment')
@Controller('/api/enrichment')
export class EnrichmentAdminController {

  constructor(protected admin: EnrichmentAdminService) {}

  @ApiOperation({ summary: 'The enrichment module catalog: what each step fills and whether overwrite applies to it' })
  @Get('modules')
  modules() {
    return ENRICHMENT_MODULES;
  }

  @ApiOperation({
    summary: 'Start an enrichment job (asynchronous - poll GET /api/enrichment/jobs/:id)',
    description: 'Fill-only by default: only not-yet-enriched entities are touched. overwrite=true re-enriches them instead (never sticky). The vectorize step needs explicit targets.opusPaths.',
  })
  @HttpCode(202)
  @ApiBody({
    type: EnrichmentRunDto,
    examples: {
      everythingMissing: {
        summary: 'All three metadata steps, fill-missing only (safe)',
        value: { steps: ['author', 'work', 'cover'] },
      },
      redoOneAuthor: {
        summary: 'Re-enrich one author, replacing existing data (the overwrite switch)',
        value: { steps: ['author'], targets: { authorStrIds: ['vasile-alecsandri'] }, overwrite: true },
      },
      oneWork: {
        summary: 'One work: summary + a fresh cover',
        value: { steps: ['work', 'cover'], targets: { opusPaths: ['opera/alecsandri/lume-ridicata.xml'] } },
      },
      revectorizeOne: {
        summary: 'Vectorize one opus (fill-only: reuses stored sha256s, embeds only the missing paragraphs)',
        value: { steps: ['vectorize'], targets: { opusPaths: ['opera/alecsandri/lume-ridicata.xml'] } },
      },
    },
  })
  @Post('run')
  run(@Body() dto: EnrichmentRunDto): Promise<Record<string, unknown>> {
    return this.admin.start(this.toRequest(dto)) as unknown as Promise<Record<string, unknown>>;
  }

  @ApiOperation({
    summary: 'Dry run: list the candidates this request would process, without any external call',
    description: 'Fill-only mode lists the not-yet-enriched entities; overwrite=true lists everyone. Always read-only - nothing is persisted.',
  })
  @HttpCode(200)
  @ApiBody({
    type: EnrichmentRunDto,
    examples: {
      preview: {
        summary: 'Who are the missing-bio authors and summary-less works?',
        value: { steps: ['author', 'work'] },
      },
      previewOverwrite: {
        summary: 'What would a full re-enrichment cover?',
        value: { steps: ['author', 'work'], overwrite: true },
      },
    },
  })
  @Post('run/dry-run')
  dryRun(@Body() dto: EnrichmentRunDto) {
    return this.admin.dryRun(this.toRequest(dto));
  }

  @ApiOperation({ summary: 'Recent enrichment jobs, newest first (in memory only - restart forgets them)' })
  @Get('jobs')
  jobs() {
    return this.admin.list();
  }

  @ApiOperation({ summary: 'One enrichment job: state, per-step counters and the first errors' })
  @Get('jobs/:id')
  job(@Param('id') id: string) {
    return this.admin.get(id);
  }

  @ApiOperation({ summary: 'Ask the running job to stop after its current entity (cooperative)' })
  @HttpCode(202)
  @Post('jobs/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.admin.cancel(id);
  }

  @ApiOperation({ summary: "Which enrichment fields one author already has (bio, Wikidata facts, images)" })
  @Get('author/:strId')
  author(@Param('strId') strId: string) {
    return this.admin.authorStatus(strId);
  }

  @ApiOperation({ summary: 'Which enrichment fields one work already has (summary, quote, cover)' })
  @Get('work')
  work(@Query('path') path: string) {
    return this.admin.workStatus(path);
  }

  private toRequest(dto: EnrichmentRunDto): EnrichmentRunRequest {
    return {
      steps: dto.steps,
      targets: dto.targets,
      overwrite: dto.overwrite,
    };
  }
}
