import { Body, Controller, HttpCode, Logger, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RagAnswerResponse, RagChatResponse, RagSearchResponse, RagService } from './rag.service';

export class RagScopeDto {
  @ApiPropertyOptional({
    example: ['creanga/amintiri_din_copilarie'],
    description: 'The works to search, as author/opus paths: one work to chat with a book, several for a collection. Omit (or leave empty) for the whole library.',
  })
  opusPaths?: string[];
}

class RagRequestDto {
  @ApiPropertyOptional({ type: RagScopeDto })
  scope?: RagScopeDto;

  @ApiPropertyOptional({ example: 0.9, description: 'Leave out passages farther than this Euclid distance from the question (bge-m3: ~0.8 close, ~1.1 loosely related).' })
  maxDistance?: number;
}

export class RagSearchDto extends RagRequestDto {
  @ApiProperty({ example: 'copilăria la Humulești', description: 'What to look for, in any language.' })
  query: string;

  @ApiPropertyOptional({ example: 10, description: 'Passages returned, 1-50. Default 10.' })
  topK?: number;
}

export class RagTurnDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  role: 'user' | 'assistant';

  @ApiProperty()
  content: string;
}

export class RagAskDto extends RagRequestDto {
  @ApiProperty({ example: 'Ce făcea Nică la școala din Humulești?', description: 'The question, in any language; the answer comes in the same one.' })
  question: string;

  @ApiPropertyOptional({ example: 6, description: 'Passages the answer is generated from, 1-12. Default 6.' })
  topK?: number;

  @ApiPropertyOptional({ type: RagTurnDto, isArray: true, description: 'The conversation so far, oldest first (at most 20 turns), when the caller keeps it.' })
  history?: RagTurnDto[];
}

export class RagChatDto extends RagRequestDto {
  @ApiProperty({ example: 'Și ce a pățit apoi?', description: 'The next message; follow-ups are understood from the conversation.' })
  message: string;

  @ApiPropertyOptional({ description: 'The conversationId of a previous reply, to continue that conversation. Conversations are kept in memory: a restart forgets them.' })
  conversationId?: string;

  @ApiPropertyOptional({ example: 6, description: 'Passages each answer is generated from, 1-12. Default 6.' })
  topK?: number;
}

/**
 * Semantic search, question answering and chat over the library's
 * paragraphs - a book, a collection of books, or all of them. Internal:
 * answers cost GPU time on the shared Ollama, so this is not meant to be
 * exposed without authentication and rate limiting in front of it.
 */
@ApiTags('rag')
@Controller('/api/rag')
export class RagController {
  private readonly log = new Logger(RagController.name);

  constructor(private readonly rag: RagService) {}

  @Post('/search')
  @HttpCode(200)
  @ApiOperation({ summary: 'The paragraphs nearest in meaning to the query, within the scope' })
  search(@Body() body: RagSearchDto): Promise<RagSearchResponse> {
    return this.rag.search(body?.query, { scope: body?.scope, topK: body?.topK, maxDistance: body?.maxDistance });
  }

  @Post('/ask')
  @HttpCode(200)
  @ApiOperation({ summary: 'An answer generated from the passages nearest to the question, citing them as [n]' })
  ask(@Body() body: RagAskDto): Promise<RagAnswerResponse> {
    return this.rag.ask(body?.question, { scope: body?.scope, topK: body?.topK, maxDistance: body?.maxDistance, history: body?.history });
  }

  @Post('/ask/stream')
  @ApiOperation({
    summary: 'As /ask, streamed as newline-delimited JSON',
    description: 'First line {"passages": [...], "question", "scope"}, then {"delta": "..."} lines as the answer is generated, then {"done": true} (or {"error": "..."}).',
  })
  async askStream(@Body() body: RagAskDto, @Res() res: Response): Promise<void> {
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    // validation errors become the usual 400 before anything is streamed
    const stream = await this.rag.streamAsk(body?.question,
      { scope: body?.scope, topK: body?.topK, maxDistance: body?.maxDistance, history: body?.history }, abort.signal);
    res.status(200).setHeader('content-type', 'application/x-ndjson; charset=utf-8');
    res.write(JSON.stringify({ question: stream.question, scope: stream.scope, passages: stream.passages }) + '\n');
    try {
      for await (const delta of stream.answer) res.write(JSON.stringify({ delta }) + '\n');
      res.end(JSON.stringify({ done: true }) + '\n');
    } catch (error) {
      if (abort.signal.aborted) return;
      this.log.error(`streamed answer failed: ${error instanceof Error ? error.message : error}`);
      res.end(JSON.stringify({ error: 'answer generation failed' }) + '\n');
    }
  }

  @Post('/chat')
  @HttpCode(200)
  @ApiOperation({ summary: 'The next turn of a conversation over the scope: follow-ups are rewritten from the conversation before searching' })
  chat(@Body() body: RagChatDto): Promise<RagChatResponse> {
    return this.rag.chat(body?.message, { scope: body?.scope, topK: body?.topK, maxDistance: body?.maxDistance, conversationId: body?.conversationId });
  }
}
