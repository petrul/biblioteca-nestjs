import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RagChatDto } from './biblioteca-rag/rag.controller';
import { RagChatResponse, RagService } from './biblioteca-rag/rag.service';

/** The reader-facing chat surface. Retrieval is delegated to Biblioteca MCP. */
@ApiTags('chat')
@Controller('/api/mcp/chat')
export class ChatController {
  constructor(private readonly rag: RagService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'The next grounded turn of a Biblioteca conversation' })
  chat(@Body() body: RagChatDto): Promise<RagChatResponse> {
    return this.rag.chat(body?.message, { scope: body?.scope, topK: body?.topK, maxDistance: body?.maxDistance, conversationId: body?.conversationId });
  }
}
