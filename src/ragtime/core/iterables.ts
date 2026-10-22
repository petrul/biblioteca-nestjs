import { TextItem, TextIterable } from './model';

/** Groups any async iterable into arrays of at most batchSize. */
export async function* batchesOf<T>(items: AsyncIterable<T>, batchSize: number): AsyncIterable<T[]> {
  if (!(batchSize > 0)) throw new Error(`batch size must be positive, got ${batchSize}`);
  let batch: T[] = [];
  for await (const item of items) {
    batch.push(item);
    if (batch.length >= batchSize) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) yield batch;
}

/** A TextIterable over an async generator function - each iteration starts it afresh. */
export class GeneratorTextIterable<T extends TextItem> implements TextIterable<T> {
  constructor(private readonly items: () => AsyncIterable<T>) {}

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this.items()[Symbol.asyncIterator]();
  }

  getBatches(batchSize: number): AsyncIterable<T[]> {
    return batchesOf(this, batchSize);
  }
}

/** A finite, in-memory TextIterable: collections of human dimensions. */
export class ArrayTextIterable<T extends TextItem> extends GeneratorTextIterable<T> {
  constructor(items: readonly T[]) {
    super(async function* () {
      yield* items;
    });
  }
}
