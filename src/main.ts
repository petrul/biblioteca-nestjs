#!/usr/bin/env node

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['verbose', 'debug', 'log', 'warn', 'error' ]
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
