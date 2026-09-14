# Textbase Vectorizer (textbase-nestjs)

A small, standalone NestJS worker that turns [textbase-server](../textbase-server)'s
text content into vector embeddings and stores them in Milvus — so the
main server's semantic ("vector"/"deep") search has something to search
against.

## What it does

- Listens to a Kafka topic textbase-server publishes to whenever an opus
  (a work) is imported or reimported.
- On each such event, fetches every paragraph of that opus from
  textbase-server, embeds the ones that haven't already been embedded
  (tracked by content hash, not just URL — see [Algorithm](#algorithm)),
  and writes the resulting vectors into the matching Milvus collection.
- Runs entirely independently of textbase-server: deployed, scaled, and
  restarted on its own schedule, communicating only over Kafka and HTTP.

## Why it's useful

Vectorizing a large text corpus is slow and has its own failure modes
(a model server being briefly unreachable, a paragraph's text changing
after a re-edit, duplicate content across works). Keeping that entirely
separate from the server that actually serves reader traffic means a
vectorization backlog, a model swap, or a Milvus hiccup never risks taking
the reading experience down with it.

## Quickstart

Prerequisites: Node 18+, a reachable Kafka broker, Milvus instance, and an
Ollama (or sentence-transformers) server, plus a reachable textbase-server
to pull content from and to read shared config off of.

```bash
git clone <this repo>
cd textbase-nestjs
cp .env.example .env.dev   # then fill in your Kafka/Milvus/Ollama/textbase-server values
rake npminstall
rake run[dev]     # loads .env.dev, then `npm run start`
```

For iterating with auto-restart on file changes, load the env yourself and
use Nest's watch mode instead: `set -a && source .env.dev && set +a && npm run start:dev`.

There's nothing to open in a browser — this is a background worker. Watch
its logs for `Kafka consumer connected` and vectorization activity as
opera get imported on the textbase-server side.

## Running tests

```bash
rake test[dev]     # or: npx jest
```

Most specs run against fakes (no live services needed) — see
[Notable specs](#notable-specs) for the handful that talk to a real Ollama
server and take longer as a result.

## Docker

```bash
rake docker:build     # build editii/textbase-vectorizer:<version> locally
rake docker:publish    # also push to mini.local:5000
```

---

## Configuration: what's actually load-bearing

`.env.example` lists every environment variable `src/configuration.ts`
requires at startup — but **not all of them still do anything**. Since the
shared-config change described below, two groups exist:

| Still genuinely used | Value now comes from textbase-server instead (must still be *set*, but the value is ignored) |
| --- | --- |
| `KAFKA_SERVERS`, `KAFKA_GROUP_ID` | `KAFKA_TOPIC` |
| `STS_SERVER`, `OLLAMA_SERVER` | `MLVCOL_TB_PARAS_ALL_MPNET_BASE_V2` |
| `MINI_MILVUS` | `MLVCOL_TB_PARAS_QWEN3_EMBEDDING_4B` |
| `TEXTBASE_URL` | `MLVCOL_TB_PARAS_BGE_M3` |
| `TB_GETPARAS_PAGE_SIZE` | `MLVCOL_TEXTBASE_PARAS_STS_ALL_MINILM_L6_V2` |

Don't try to change which Milvus collection or Kafka topic this service
uses by editing the right-hand column — it won't work. See
[Shared config](#shared-config-the-important-part) for where those values
actually come from.

### Shared config (the important part)

At bootstrap, this service fetches `GET /api/admin/config` from
textbase-server (`app.module.ts`'s `PROVIDER_SHARED_CONFIG`, wrapped in
`retryUntilAvailable` since textbase-server may not be up yet) and uses
*that* — not its own env vars — to decide:

- which Kafka topic to consume (`shared.kafka.newOpusImportedTopic`)
- which Milvus collection to write to, and its vector dimension
  (`shared.milvus.collection`, `shared.embedder.dimension`)
- which embedding model to actually call (`shared.embedder.ollamaModel`)

This means textbase-server is the single source of truth for that naming
convention — this service structurally cannot disagree with it about
which collection or topic to use, because it never makes its own decision
about either. `SharedTextbaseConfig` (`src/configuration.ts`) documents
the exact shape fetched.

## Embedding backends

Every embedder implements the `ContentEmbedder` interface
(`embeddings(content: Content[]): Promise<Content[]>`, filling in each
item's `embedding` field) — `VectorizerService` and everything downstream
only ever depends on that interface (`PROVIDER_EMBEDDER`), never a
concrete implementation. Whichever model textbase-server's shared config
reports as active is what actually gets used at runtime; the rest remain
registered and available for explicit/manual use.

| Implementation | Model | Dim | Notes |
| --- | --- | --- | --- |
| `Qwen3EmbeddingOllamaService` (`services/ollama`) | Qwen3-Embedding-4B via Ollama | 2560 | Was the default; superseded by BGE-M3 |
| `BgeM3OllamaService` (`services/ollama`) | BGE-M3 via Ollama | 1024 | Currently active, per textbase-server's shared config |
| `NomicEmbedOllamaService` (`services/ollama`) | nomic-embed-text via Ollama | 768 | Registered, not wired in as default anywhere |
| `AllMpnetBaseV2_StsService` (`services/sts`) | all-mpnet-base-v2 via sentence-transformers | 768 | The original embedder, before the move to Ollama-backed models |

`OllamaService` is the shared low-level client (`POST /api/embed`,
Ollama's batch-capable endpoint) behind every Ollama-backed embedder above;
`DynamicOllamaEmbedder` parametrizes it by model name at runtime rather
than needing one hardcoded class per model, since Ollama has no fixed
model catalog the way the STS server does.

### Startup availability checks

Two dependencies are checked for reachability at startup and *waited out*
(5s poll interval, no cap — `retryUntilAvailable` in `src/util.ts`)
rather than crashing the process:

- **The embedder** — wrapped in `RetryingContentEmbedder`;
  `VectorizerService.onModuleInit()` makes an explicit throwaway call
  through it before the Kafka listener starts consuming, so an
  unreachable embedder is caught at boot, not on the first real message.
- **Milvus** — the `MilvusCollection` provider factory runs the same way
  during Nest's own bootstrap, so an unreachable Milvus blocks startup
  (retrying) rather than crashing it outright.

This only covers reachability *at startup*. A failure partway through a
`vectorize()` call (Milvus going down mid-opus, or anything else) is a
Kafka concern instead: the per-message handler re-throws after logging,
so kafkajs doesn't commit that message's offset and redelivers/retries it
rather than silently dropping it.

## Algorithm

On a new-opus-imported event: fetch every paragraph of that opus, diff
against the sha256 hashes already stored in Milvus for it, and only embed
+ upload the paragraphs whose content hash is new — paragraphs that
haven't changed since the last run are skipped entirely.

### Known limitations

These are real, currently-unhandled edge cases in that diffing algorithm,
not aspirational features:

- If a paragraph's URL changes but its content (and hash) doesn't — e.g.
  moving it into a subchapter — the stored record still points at the old
  URL, which goes stale.
- Duplicate content across different URLs is currently stored as separate
  vectors rather than deduplicated by hash.
- A paragraph that's removed from the source (reorganized away, stanzas
  merged) isn't removed from Milvus — it lingers as an orphaned vector.

The likely fix shape: upsert on `(sha256, url)` as a compound key — where
both match, skip; where only the hash matches, update the URL in place;
otherwise insert as new.

## Package map (orientation for developers & coding agents)

| Path | What's there |
| --- | --- |
| `src/app.module.ts` | Dependency wiring — the fastest place to see how every provider above actually connects |
| `src/configuration.ts` | Env var loading (`VectorizerConfiguration`) and the `SharedTextbaseConfig` shape fetched from textbase-server |
| `src/services/kafka/` | `KafkaService`, `ProducerService`, `KafkaListenerService` (the consumer that triggers vectorization) |
| `src/services/ollama/`, `src/services/sts/` | The embedder implementations (see [Embedding backends](#embedding-backends)) |
| `src/services/milvus/` | `MilvusCollection` — collection creation, dimension assertions, upserts |
| `src/services/vector_store.ts` | `MilvusColVectorStore` — the storage-facing side of a vectorize() call |
| `src/services/vectorizer.service.ts` | The orchestration: fetch paragraphs → diff → embed → store |
| `src/services/textbase_client.service.ts` | `TextbaseClient` — this worker's HTTP client into textbase-server (paragraphs, shared config) |
| `src/services/retrying_content_embedder.ts`, `src/util.ts` | The `retryUntilAvailable`/retry-wrapper machinery used throughout |
| `src/model/model.ts` | `ContentEmbedder` interface, `Content` shape, `PROVIDER_EMBEDDER` token |
| `test/fake-textbase-client.ts`, `test/res/paras.json` | Fixture data and fake client used by tests instead of a live textbase-server |

For a concrete task, `app.module.ts` is the fastest way to see how
everything is actually wired together before diving into any one service.

## Notable specs

- `services/ollama/ollama.service.spec.ts` — runs against a real Ollama
  server (dimension checks, the `Content[]` adapter contract, a
  cross-model sanity check). 2-minute per-test timeout since a
  cold-loaded model's first call can be slow.
- `retrying_content_embedder.spec.ts` / `util.spec.ts` — the
  retry-on-failure wrapper and its underlying helper, with a mocked inner
  embedder (fast, no real network): succeeds-first-try, recovers after
  several failures, logs one short warning per attempt rather than a
  stack trace, and proves there's no small hardcoded retry cap.
- `textbase_client.service.spec.ts` / `vectorizer.service.spec.ts` — run
  against `test/fake-textbase-client.ts`'s `FakeTextbaseClient` rather
  than a live textbase-server, since one with real content isn't reliably
  reachable from a dev box. Serves fixture data from `test/res/paras.json`
  (recomputing each paragraph's `text_sha256` at load time, since some
  stored values are stale), plus 1200 synthesized entries for pagination
  tests.
- `services/sts/sts.service.spec.ts` — the original STS embedder.

## Regenerating the textbase-server API client

`swagger-typescript-api` generates this project's typed client from
textbase-server's own OpenAPI spec:

```bash
./gen-tb-api.sh
```

Downloads the live spec from the production server and regenerates
`src/textbase.api.ts` (and the sentence-transformers client alongside it)
— run this after textbase-server's API surface changes.
