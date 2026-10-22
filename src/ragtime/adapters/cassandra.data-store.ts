import { Client } from 'cassandra-driver';
import { DataStore, TextItem, MemTextItem } from '../core';

export interface CassandraDataStoreOptions {
  contactPoints: string[];
  localDataCenter: string;
  keyspace: string;
  /** Default 'text_items'. */
  table?: string;
  /** Concurrent writes of saveBatch. Default 16. */
  concurrency?: number;
}

/**
 * DataStore of TextItems in Cassandra: one row per item id, its text and
 * JSON metadata. Read back as MemTextItems. Call init() once before use; it
 * creates the table when missing (the keyspace must exist).
 */
export class CassandraDataStore implements DataStore<TextItem> {
  private readonly client: Client;
  private readonly table: string;

  constructor(private readonly options: CassandraDataStoreOptions) {
    if (!/^[a-z][a-z0-9_]*$/.test(options.table ?? 'text_items')) throw new Error(`invalid table name ${options.table}`);
    this.table = options.table ?? 'text_items';
    this.client = new Client({
      contactPoints: options.contactPoints,
      localDataCenter: options.localDataCenter,
      keyspace: options.keyspace,
    });
  }

  async init(): Promise<void> {
    await this.client.connect();
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id text PRIMARY KEY,
        source_id text,
        url text,
        title text,
        language text,
        content text,
        metadata text
      )`);
  }

  async shutdown(): Promise<void> {
    await this.client.shutdown();
  }

  async save(item: TextItem): Promise<void> {
    await this.client.execute(
      `INSERT INTO ${this.table} (id, source_id, url, title, language, content, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.sourceId, item.url, item.title ?? null, item.language ?? null, await item.getText(), JSON.stringify(item.metadata ?? {})],
      { prepare: true },
    );
  }

  async saveBatch(items: TextItem[]): Promise<void> {
    const concurrency = this.options.concurrency ?? 16;
    for (let i = 0; i < items.length; i += concurrency) {
      await Promise.all(items.slice(i, i + concurrency).map((item) => this.save(item)));
    }
  }

  async findById(id: string): Promise<TextItem | null> {
    const result = await this.client.execute(
      `SELECT id, source_id, url, title, language, content, metadata FROM ${this.table} WHERE id = ?`, [id], { prepare: true });
    const row = result.first();
    if (!row) return null;
    return new MemTextItem(row.source_id, row.url, row.content ?? '', JSON.parse(row.metadata || '{}'),
      { id: row.id, title: row.title ?? undefined, language: row.language ?? undefined });
  }

  /** The stored items among those ids, in the order of the ids. */
  async findByIds(ids: string[]): Promise<TextItem[]> {
    const results = await Promise.all(ids.map((id) => this.findById(id)));
    return results.filter((item): item is TextItem => item !== null);
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.client.execute(`DELETE FROM ${this.table} WHERE id IN ?`, [ids], { prepare: true });
  }
}
