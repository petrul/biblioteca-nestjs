import { Injectable, OnModuleInit } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { VectorStore, VectorRecord, VectorQueryResult } from '../model/ragtime.model';

@Injectable()
export class QdrantVectorStore implements VectorStore, OnModuleInit {
  private client: QdrantClient;

  constructor() {
    this.client = new QdrantClient({
      url: process.env.QDRANT_URL || 'http://localhost:6333',
      apiKey: process.env.QDRANT_API_KEY,
    });
  }

  async onModuleInit() {
    // Initialization hook
  }

  async ensureCollection(collection: string, vectorSize = 1536): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some((c) => c.name === collection);

    if (!exists) {
      await this.client.createCollection(collection, {
        vectors: {
          size: vectorSize,
          distance: 'Cosine',
        },
      });
    }
  }

  async upsert(collection: string, records: VectorRecord[]): Promise<void> {
    await this.ensureCollection(collection, records[0]?.vector.length ?? 1536);

    await this.client.upsert(collection, {
      points: records.map((r) => ({
        id: r.id,
        vector: r.vector,
        payload: r.payload,
      })),
    });
  }

  async query(collection: string, vector: number[], topK = 5): Promise<VectorQueryResult[]> {
    const response = await this.client.search(collection, {
      vector,
      limit: topK,
      with_payload: true,
    });

    return response.map((point) => ({
      id: String(point.id),
      score: point.score,
      payload: (point.payload as Record<string, unknown>) || {},
    }));
  }
}