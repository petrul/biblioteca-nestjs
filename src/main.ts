#!/usr/bin/env node

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['verbose', 'debug', 'log', 'warn', 'error' ]
  });

  app.use((req: any, res: any, next: () => void) => {
    const path = req.path as string;
    const protectedMutation = req.method === 'POST' && (
      /^\/api\/vectorizing\/(start|pause|resume)$/.test(path)
      || /^\/api\/enrichment\/(run|run\/dry-run)$/.test(path)
      || /^\/api\/enrichment\/jobs\/[^/]+\/cancel$/.test(path)
      || /^\/api\/covers\/(run|run\/dry-run|work)$/.test(path)
      || /^\/api\/covers\/jobs\/[^/]+\/cancel$/.test(path)
      || path === '/api/vector-store/remove-opus'
      || path === '/api/vector-store/reset'
      || path === '/optimize'
    );
    if (!protectedMutation) return next();

    const token = process.env.NESTJS_INTERNAL_API_TOKEN;
    if (!token) return res.status(503).json({ error: 'Internal API authorization is not configured' });
    const supplied = Buffer.from(req.get('authorization') || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return res.status(403).json({ error: 'Internal API token required' });
    }
    next();
  });

  const config = new DocumentBuilder()
    .setTitle('Biblioteca NestJS')
    .setDescription('Textbase Vectorizer computes embeddings of text excerpts')
    .setVersion('0.1')
    .addTag('textbase')
    .addTag('enrichment', 'Manual enrichment admin: retrigger author/work/cover/vectorize enrichment integrally or partially, fill-only by default')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/ui', app, document);

  await app.listen(Number(process.env.PORT) || 3334);
}

bootstrap();
