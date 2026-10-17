import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Client, mapping } from 'cassandra-driver';
import { DataStore, TextItem, MemTextItem } from '../model/ragtime.model';

@Injectable()
export class CassandraDataStore implements DataStore<TextItem>, OnModuleInit, OnModuleDestroy {
  private client: Client;
  private mapper: mapping.ModelMapper<TextItem>;

  constructor() {
    this.client = new Client({
      contactPoints: (process.env.CASSANDRA_CONTACT_POINTS || 'localhost').split(','),
      localDataCenter: process.env.CASSANDRA_DATACENTER || 'datacenter1',
      keyspace: process.env.CASSANDRA_KEYSPACE || 'scriptorium_rag',
    });
  }

  async onModuleInit() {
    await this.client.connect();

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS text_items (
        id text PRIMARY KEY,
        source_id text,
        url text,
        content text,
        metadata text
      );
    `);

    const mappingManager = new mapping.MappingManager(this.client);
    this.mapper = mappingManager.forModel<TextItem>('TextItem', {
      tables: ['text_items'],
      columns: {
        id: 'id',
        sourceId: 'source_id',
        url: 'url',
        content: {
          name: 'content',
          fromModel: async (item: TextItem) => await item.getText(),
        },
        metadata: {
          name: 'metadata',
          fromModel: (m: Record<string, unknown>) => JSON.stringify(m),
          toModel: (s: string) => JSON.parse(s || '{}'),
        },
      },
    });
  }

  async onModuleDestroy() {
    await this.client.shutdown();
  }

  async save(item: TextItem): Promise<void> {
    await this.mapper.insert({
      id: item.id,
      sourceId: item.sourceId,
      url: item.url,
      content: await item.getText(),
      metadata: item.metadata,
    });
  }

  async saveBatch(items: TextItem[]): Promise<void> {
    await Promise.all(items.map((item) => this.save(item)));
  }

  async findById(id: string): Promise<TextItem | null> {
    const result = await this.mapper.get({ id });
    if (!result) return null;

    const row = result as unknown as {
      id: string;
      sourceId: string;
      url: string;
      content: string;
      metadata: Record<string, unknown>;
    };

    return new MemTextItem(row.sourceId, row.url, row.content, row.metadata, row.id);
  }

  async findByIds(ids: string[]): Promise<TextItem[]> {
    const results = await Promise.all(ids.map((id) => this.findById(id)));
    return results.filter((item): item is TextItem => item !== null);
  }
}