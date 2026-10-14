import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BibliotecaClient } from './services/biblioteca_client.service';
import { CoverEnrichmentService } from './services/cover-enrichment.service';
import { coverCandidateFor } from './services/kafka/author-arts';

export class CoverWorkRequestDto {
  @ApiProperty({ example: 'eminescu/poezii', description: 'The work\'s stable id, authorStrId/opusStrId.' })
  path!: string;

  @ApiProperty({
    description: 'Optional POST /api/cover request JSON to render from (the reader admin\'s edited JSON). Omit for a random request.',
    type: 'object', additionalProperties: true, nullable: true, required: false,
  })
  request?: Record<string, unknown> | null;
}

export class CoverWorkDto {
  @ApiProperty({ description: 'The work\'s current cover URL (MinIO), if any.', required: false })
  coverUrl?: string;

  @ApiProperty({
    description: 'The POST /api/cover request JSON the current cover was rendered from; null for covers rendered before requests were recorded.',
    type: 'object', additionalProperties: true, nullable: true,
  })
  request!: Record<string, unknown> | null;
}

/**
 * One work's cover, on demand - the reader's admin section on the back of a
 * work card (proxied same-origin by biblioteca-reader, which checks the
 * signed-in user is an administrator).
 */
@ApiTags('covers')
@Controller('/api/covers')
export class CoverWorkController {

  constructor(protected tbc: BibliotecaClient, protected covers: CoverEnrichmentService) {}

  @ApiOperation({
    summary: 'Render a new cover for one work, synchronously, replacing its current cover',
    description: 'Waits for the render and the MinIO upload (seconds to a minute). Responds with the new cover URL and the request JSON it was rendered from. Pass a request JSON to render from it; omit it for a random one.',
  })
  @ApiBody({ type: CoverWorkRequestDto })
  @HttpCode(200)
  @Post('work')
  async generate(@Body() dto: CoverWorkRequestDto): Promise<CoverWorkDto> {
    const opus = await this.work(dto?.path);
    const candidate = await coverCandidateFor(this.tbc, opus);
    try {
      return await this.covers.generateNow(candidate, dto.request ?? undefined);
    } catch (error: any) {
      if (/already being rendered/.test(error?.message)) throw new ConflictException(error.message);
      throw error;
    }
  }

  @ApiOperation({
    summary: 'A fresh random cover request JSON for one work, without rendering it',
    description: 'What POST /work would have rendered from at this moment. The reader admin\'s "New random JSON" fills its editor with this; coverUrl is the work\'s current cover, untouched.',
  })
  @ApiQuery({ name: 'path', example: 'eminescu/poezii' })
  @Get('work/request/random')
  async randomRequest(@Query('path') path: string): Promise<CoverWorkDto> {
    const opus = await this.work(path);
    const candidate = await coverCandidateFor(this.tbc, opus);
    return { coverUrl: opus.coverUrl, request: await this.covers.randomRequest(candidate) };
  }

  @ApiOperation({ summary: 'The request JSON one work\'s current cover was rendered from' })
  @ApiQuery({ name: 'path', example: 'eminescu/poezii' })
  @Get('work/request')
  async request(@Query('path') path: string): Promise<CoverWorkDto> {
    const opus = await this.work(path);
    return { coverUrl: opus.coverUrl, request: await this.covers.storedRequest(opus.coverUrl) };
  }

  private async work(path: string | undefined): Promise<any> {
    if (!path || !/^[^/]+\/[^/]+$/.test(path)) throw new BadRequestException('path must be authorStrId/opusStrId');
    let opus: any;
    try {
      opus = await this.tbc.getElemByPath(path);
    } catch (error: any) {
      if (error?.status === 404) throw new NotFoundException(`no work ${path}`);
      throw error;
    }
    if (!opus?.id || !opus?.head) throw new NotFoundException(`no work ${path}`);
    return { ...opus, path: opus.path || path };
  }
}
