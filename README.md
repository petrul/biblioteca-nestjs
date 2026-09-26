# Biblioteca NestJS Vectorizer

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
cd biblioteca-nestjs
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
rake docker:build     # build editii/biblioteca-nestjs:<version> locally
rake docker:publish    # also push to mini.local:5000
```

---

## Configuration: what's actually load-bearing

`.env.example` lists the complete set of environment variables
`src/configuration.ts` requires at startup: `KAFKA_BROKERS`,
`STS_SERVER`, `OLLAMA_SERVER`, `MILVUS_URL`, `BIBLIOTECA_EXTERNAL_URL` —
the shared pass-store names the whole Biblioteca family uses, so the worker
boots directly off a sourced `biblioteca/<stage>` environment with no
renaming in between. There used to be more of these — a per-collection env
var for each Milvus collection, a `KAFKA_TOPIC`, a `TB_GETPARAS_PAGE_SIZE`,
and a `KAFKA_GROUP_ID` — but
the Milvus/topic/page-size ones are now decided by textbase-server (see
[Shared config](#shared-config-the-important-part)), and the consumer
group id is the worker's own identity, the same in every environment, so
it's the hardcoded `biblioteca_nestjs` constant in
`src/configuration.ts` instead of an env var — in all cases the variables
were removed rather than left around unused.

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

## Kafka contract (AsyncAPI)

`KafkaListenerService` (`src/services/kafka/listener.service.ts`) is this
service's one Kafka consumer — the message schema it consumes, and
textbase-server's other topics this service *doesn't* touch, are
documented in full in biblioteca-server's `src/main/resources/static/asyncapi.yml` rather than
duplicated here (textbase-server is the sole producer of everything on
Kafka in this whole system, so that's the natural source of truth).

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
| `src/services/biblioteca_client.service.ts` | `BibliotecaClient` — this worker's HTTP client into biblioteca-server (paragraphs, shared config) |
| `src/services/retrying_content_embedder.ts`, `src/util.ts` | The `retryUntilAvailable`/retry-wrapper machinery used throughout |
| `src/model/model.ts` | `ContentEmbedder` interface, `Content` shape, `PROVIDER_EMBEDDER` token |
| `test/fake-biblioteca-client.ts`, `test/res/paras.json` | Fixture data and fake client used by tests instead of a live textbase-server |

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
- `biblioteca_client.service.spec.ts` / `vectorizer.service.spec.ts` — run
  against `test/fake-biblioteca-client.ts`'s `FakeBibliotecaClient` rather
  than a live textbase-server, since one with real content isn't reliably
  reachable from a dev box. Serves fixture data from `test/res/paras.json`
  (recomputing each paragraph's `text_sha256` at load time, since some
  stored values are stale), plus 1200 synthesized entries for pagination
  tests.
- `services/sts/sts.service.spec.ts` — the original STS embedder.

## This service's own API

A small admin/control surface (`src/app.controller.ts`), not the vectorization
pipeline itself (that's driven entirely by Kafka - see
[Shared config](#shared-config-the-important-part) and
[Kafka contract](#kafka-contract-asyncapi) above/below):

| Endpoint | What it does |
| --- | --- |
| `GET /api/info` | Name + version from `package.json` |
| `POST /revectorize_all?shuffle=` | Walks every opus via `BibliotecaClient` and re-vectorizes each one, optionally in random order; stoppable mid-run |
| `POST /stop_vectorizing` | Signals a running `revectorize_all` to halt after its current opus |
| `POST /optimize` | Compacts the Milvus collection |

`@nestjs/swagger` (`src/main.ts`) serves a live OpenAPI document for this
at `/api/ui` - same mechanism, one instance per this app rather than a
checked-in export like textbase-server's, since this surface is small and
purely operational (no external client generates against it the way the
reader generates against textbase-server's).

## Regenerating the biblioteca-server API client

`swagger-typescript-api` generates this project's typed client from
biblioteca-server's own OpenAPI spec:

```bash
./gen-biblioteca-api.sh
```

Downloads the live spec from the production server and regenerates
`src/biblioteca.api.ts` (and the sentence-transformers client alongside it)
— run this after textbase-server's API surface changes.
