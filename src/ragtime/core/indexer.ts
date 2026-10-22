import {
  DataStore,
  Embedder,
  Indexer,
  IndexingStats,
  IndexOptions,
  TextItem,
  TextSource,
  VectorRecord,
  VectorStore,
} from './model';

/** Whether the embedder makes sense of text in that language (unknown: only a multilingual one). */
export function embeds(embedder: Embedder, language: string | undefined): boolean {
  const supported = embedder.supportedLanguages;
  return supported === 'all' || (language != null && supported.includes(language));
}

/** The payload stored next to an item's vector unless the indexing says otherwise. */
export function defaultPayload(item: TextItem): Record<string, unknown> {
  return {
    source_id: item.sourceId,
    url: item.url,
    ...(item.title ? { title: item.title } : {}),
    ...(item.language ? { language: item.language } : {}),
    ...item.metadata,
  };
}

/** embedBatch in calls of at most the embedder's maxBatchSize. */
export async function embedAll(embedder: Embedder, texts: string[]): Promise<number[][]> {
  const size = embedder.maxBatchSize && embedder.maxBatchSize > 0 ? embedder.maxBatchSize : texts.length;
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += size) {
    const chunk = texts.slice(i, i + size);
    const embedded = await embedder.embedBatch(chunk, 'passage');
    if (embedded.length !== chunk.length) {
      throw new Error(`${embedder.modelName} returned ${embedded.length} vectors for ${chunk.length} texts`);
    }
    vectors.push(...embedded);
  }
  return vectors;
}

function samePayload(stored: Record<string, unknown>, wanted: Record<string, unknown>): boolean {
  return Object.entries(wanted).every(([key, value]) => JSON.stringify(stored[key]) === JSON.stringify(value));
}

/**
 * Reads a source batch by batch, embeds what is new and stores it: vectors in
 * the vector store, items in the data store when there is one.
 */
export class GenericIndexer implements Indexer {
  constructor(
    private readonly embedder: Embedder,
    private readonly vectorStore: VectorStore,
    private readonly dataStore?: DataStore,
  ) {}

  async indexSource<T extends TextItem>(source: TextSource<T>, collection: string, options: IndexOptions<T> = {}): Promise<IndexingStats> {
    const startTime = Date.now();
    const stats: IndexingStats = {
      processedItems: 0, generatedVectors: 0, reusedVectors: 0, repointedVectors: 0, skippedItems: 0, durationMs: 0,
    };
    const prepare = options.prepareText ?? ((text: string) => (text.trim() ? text : null));
    const payloadOf = (options.payloadOf ?? defaultPayload) as (item: TextItem) => Record<string, unknown>;
    const reuse = options.reuse ?? true;
    const log = options.log ?? (() => undefined);
    const maxChars = this.embedder.maxInputChars;

    for await (const batch of source.getItems().getBatches(options.batchSize ?? 10)) {
      const items: TextItem[] = options.splitter
        ? (await Promise.all(batch.map((item) => options.splitter!.split(item)))).flat()
        : batch;
      // one id once per batch: one point id must occur once per upsert
      const unique = [...new Map(items.map((item) => [item.id, item])).values()];
      const prepared: { item: TextItem; text: string; payload: Record<string, unknown> }[] = [];
      let unsupported = 0;
      for (const item of unique) {
        const text = prepare(await item.getText(), item as T);
        if (text == null) {
          stats.skippedItems++;
        } else if (!embeds(this.embedder, item.language)) {
          stats.skippedItems++;
          unsupported++;
        } else {
          prepared.push({ item, text: text.length > maxChars ? text.slice(0, maxChars) : text, payload: payloadOf(item) });
        }
      }
      if (unsupported > 0) {
        log(`skipping ${unsupported} of ${unique.length} items: language not supported by ${this.embedder.modelName} `
          + `(supports: ${this.embedder.supportedLanguages})`);
      }

      const stored = reuse && prepared.length > 0
        ? new Map((await this.vectorStore.retrieve(collection, prepared.map((it) => it.item.id))).map((it) => [it.id, it.payload]))
        : new Map<string, Record<string, unknown>>();
      const toEmbed = prepared.filter((it) => !stored.has(it.item.id));
      const toRepoint = prepared.filter((it) => stored.has(it.item.id) && !samePayload(stored.get(it.item.id)!, it.payload));
      stats.reusedVectors += prepared.length - toEmbed.length - toRepoint.length;
      if (stored.size > 0) {
        log(`reusing ${stored.size - toRepoint.length} stored vectors, repointing ${toRepoint.length}, embedding ${toEmbed.length}`);
      }

      if (toRepoint.length > 0) {
        await this.vectorStore.setPayload(collection, toRepoint.map((it) => ({ id: it.item.id, payload: it.payload })));
        stats.repointedVectors += toRepoint.length;
      }

      if (toEmbed.length > 0) {
        const embedStart = Date.now();
        const embeddings = await embedAll(this.embedder, toEmbed.map((it) => it.text));
        const durationMs = Date.now() - embedStart;
        const records: VectorRecord[] = toEmbed.map((it, idx) => ({ id: it.item.id, vector: embeddings[idx], payload: it.payload }));
        await Promise.all([
          this.vectorStore.upsert(collection, records),
          this.dataStore?.saveBatch([...toEmbed, ...toRepoint].map((it) => it.item)),
        ]);
        stats.generatedVectors += records.length;
        await options.onEmbedded?.({
          items: toEmbed.length,
          chars: toEmbed.reduce((sum, it) => sum + it.text.length, 0),
          dimension: embeddings[0]?.length ?? 0,
          durationMs,
        });
      } else if (toRepoint.length > 0 && this.dataStore) {
        await this.dataStore.saveBatch(toRepoint.map((it) => it.item));
      }

      stats.processedItems += prepared.length;
      await options.afterBatch?.();
      if (options.shouldStop?.()) break;
    }

    stats.durationMs = Date.now() - startTime;
    return stats;
  }
}
