#!/usr/bin/env node

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { INITIATOR_HEADER, prefixProcessOutput, propagateInitiator, requestInitiator, runAs } from './initiator';

// Every line this process writes starts with its initiator - see initiator.ts.
prefixProcessOutput();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['verbose', 'debug', 'log', 'warn', 'error' ]
  });

  // Each request runs - and logs - as the reader its caller names, or as the
  // guest of its address; its calls to biblioteca-server and biblioteca-covers
  // carry that label on ("system" for this service's own background work).
  app.use((req: any, _res: any, next: () => void) => runAs(
    requestInitiator(req.get(INITIATOR_HEADER), `${req.ip}|${req.get('user-agent') ?? ''}`), next));
  propagateInitiator([process.env.BIBLIOTECA_EXTERNAL_URL ?? '', process.env.COVERS_API_URL || 'http://localhost:3335']);

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

    const token = process.env.BIBLIOTECA_INTERNAL_API_TOKEN;
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
