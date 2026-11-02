# Vectors: what is embedded, and why nothing is dropped

## What decides what ends up in the vector store

1. **biblioteca-server decides the naming.** At startup this service reads
   `GET /api/admin/config` from biblioteca-server (`PROVIDER_SHARED_CONFIG` in
   `app.module.ts`, retried until the server is up). From it come:
   - the Kafka topics to consume and to publish human events on;
   - the collection to write to and its vector dimension
     (default `biblioteca_paragraphs_bge_m3`, prefixed `dev-`/`int-` outside
     production);
   - the embedding model (`bge-m3` via Ollama, 1024 dimensions);
   - the paragraph window, `minChars`/`maxChars` (default 20 / 3000).

   This service keeps no copy of these names, so it cannot disagree with the
   server about them. `SharedTextbaseConfig` in `src/configuration.ts` is
   the shape of that config.

2. **The paragraph window.** Paragraphs at or below `minChars` are skipped
   (BOMs, reference ids, bare numerals, speaker labels). Paragraphs above
   `maxChars` are **truncated, not dropped**, so long paragraphs and tables
   stay searchable. The stored sha256 is always that of the *full* paragraph,
   since it drives reuse.

3. **The embedder's own limit.** Each embedder declares `maxInputChars`
   (bge-m3 16384, its 8192 tokens at a conservative ~2 characters per
   token). The effective cap is `min(maxChars, maxInputChars)`, so a larger
   server window can never produce input the model would silently truncate.

The store is Qdrant (`QdrantVectorStore`, REST, deterministic UUID point ids,
rescoring on quantized collections). The point payload,
`{sha256, url, opus_path}`, is shared with biblioteca-server's own vector
search. `VECTORSTORE_URL` names the store; `MILVUS_URL` is still accepted
as a legacy name, though Milvus is retired.

## Vectors are precious: reuse by sha256, never auto-drop

Embedding the whole corpus takes **days**. The pipeline treats vectors as
an asset (`VectorizerService`, `VectorizerKafkaListenerService`,
`vector_reuse.spec.ts`):

- **Reuse before embedding.** For every page of paragraphs, the store is
  asked which sha256s already have vectors (`VectorStore.alreadyStored`);
  only the missing ones are embedded. Reimporting a book with two corrected
  paragraphs embeds exactly two.
- **Renames repoint, never re-embed.** Renaming a book changes every
  paragraph's url but no text. `VectorStore.repointUrls` updates the stored
  `url` and `opus_path` without touching the embeddings.
- **Nothing drops vectors automatically.** Imports do not purge first;
  `opusRemoved` events are logged and the vectors kept. The bulk vectorizing
  job never truncates. Stale vectors are harmless, since biblioteca-server
  filters out hits whose urls no longer resolve.

The only drops are explicit and manual, and need
`BIBLIOTECA_INTERNAL_API_TOKEN`:

| Endpoint | What it does |
| --- | --- |
| `POST /api/vector-store/remove-opus` | Removes one work's vectors (`{"path": "author/work"}`) |
| `POST /api/vector-store/reset` | Drops and recreates the whole collection |

## Failures

The embedder and the vector store are waited for at startup (a 5 s poll
with no cap, `retryUntilAvailable` in `src/util.ts`), rather than crashing
the process. `VectorizerService.onModuleInit()` makes one throwaway embedding
call before the Kafka listener starts. A failure in the middle of a work
re-throws from the message handler, so kafkajs does not commit the offset
and redelivers the message.
