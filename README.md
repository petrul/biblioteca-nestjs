
Textbase NestJS is part of the Textbase server.
aka Textbase Vectorizer

It is written in Typescript/NestJS. Works with node 18.

- its function is to basically 'vectorize' Textbase content using transformers and stores results in vector stores.

To do so, it listens to kafka topics and takes actions on some events like the import
of a new opus in Textbase.

Deliberately separate from [textbase-server](../textbase-server) (the Java/Spring app that
actually serves book/chapter/paragraph content and search) - this is a small, standalone Node
worker whose only job is turning that content into vectors, so it can be deployed, scaled, and
restarted independently of the main server.

- swagger-typescript-api is the npm package used to generate the api.
Just run:
- $ ./gen-tb-api.sh
 in the project root directory. It will download the api json from the production server and

## Embedding backends (`src/services/ollama`, `src/services/sts`, `src/model/model.ts`)

Every embedder implements the `ContentEmbedder` interface (`embeddings(content: Content[]):
Promise<Content[]>`, filling in each item's `embedding` field) - `VectorizerService` and everything
downstream of it only ever depends on that interface (`PROVIDER_EMBEDDER`), not on any concrete
implementation.

- **`Qwen3EmbeddingOllamaService`** (`services/ollama/ollama.service.ts`) - the default
  (`PROVIDER_EMBEDDER` in `app.module.ts`). Qwen3-Embedding-4B served by Ollama at `ollamaServer`
  (`zmeu.local:11434` by default), 2560-dim vectors. Replaced the sentence-transformers embedder
  below as the default; its target collection changed too (`milvus_collection_tb_qwen3_embedding_4b_paras`,
  `tb_paras_qwen3_embedding_4b` by default - a different, differently-dimensioned collection from
  the old one, since vectors from two different models aren't interchangeable).
- **`NomicEmbedOllamaService`** (same file) - nomic-embed-text, also via Ollama, 768-dim. Registered
  and usable, but not wired in as the default anywhere.
- **`OllamaService`** - the shared low-level client behind both of the above (`POST /api/embed`,
  Ollama's batch-capable embeddings endpoint). `OllamaContentEmbedderBase` is the shared abstract
  `ContentEmbedder` adapter both `Qwen3EmbeddingOllamaService`/`NomicEmbedOllamaService` extend,
  parametrized by model name - unlike the sentence-transformers server, Ollama has no fixed model
  catalog, so one generic implementation covers any model already pulled there.
- **`AllMpnetBaseV2_StsService`** (`services/sts/sts.service.ts`) - the original sentence-transformers
  (STS server) embedder, `all-mpnet-base-v2`, 768-dim. Still registered and usable under its own
  name, just no longer the default.

### Availability

Two dependencies are checked for reachability at startup, and waited out (5s poll interval, no
cap - see `retryUntilAvailable` in `src/util.ts`) rather than crashing the process:

- **The embedder** - `PROVIDER_EMBEDDER` is wrapped in `RetryingContentEmbedder`
  (`services/retrying_content_embedder.ts`), and `VectorizerService.onModuleInit()` makes an
  explicit throwaway call through it at startup, before `KafkaListenerService` (which depends on
  `VectorizerService`) starts consuming - so an unreachable embedder is caught and waited out at
  boot, not just discovered on the first real Kafka message.
- **Milvus** - the `MilvusCollection` provider's factory (`app.module.ts`) wraps
  `createAndLoadIfNotExists()` the same way. This factory runs during Nest's own app bootstrap, so
  an unreachable Milvus blocks startup (retrying) rather than crashing it.

This only covers *reachability at startup*. Failures partway through a given `vectorize()` call
(Milvus going down mid-opus, or any other error) are a Kafka concern: `KafkaListenerService`'s
per-message handler re-throws after logging rather than swallowing the error, so kafkajs does not
commit that message's offset and redelivers/retries it instead of silently dropping it.

## Run tests:

$ npx jest

Notable specs:

- `services/ollama/ollama.service.spec.ts` - `Qwen3EmbeddingOllamaService`/`NomicEmbedOllamaService`
  against the real Ollama server (dimension checks, the `Content[]` adapter contract, cross-model
  sanity check). Uses a 2-minute per-test timeout since a cold-loaded model's first call can take a
  while.
- `retrying_content_embedder.spec.ts` / `util.spec.ts` (`retryUntilAvailable` block) - the
  retry-on-failure wrapper and its underlying helper, with a mocked inner embedder (fast, no real
  network): succeeds-first-try, recovers after several failures, logs one short warning per attempt
  rather than a stack trace, and a many-failures-before-success case proving there's no small
  hardcoded retry cap. (Deliberately does *not* test genuinely-unbounded retries by racing an
  unresolvable promise - that leaves an orphaned retry loop running in the background and hangs
  Jest's process cleanup.)
- `textbase_client.service.spec.ts` / `vectorizer.service.spec.ts` - run against
  `test/fake-textbase-client.ts`'s `FakeTextbaseClient` rather than a live textbase-server, since
  none with real content is reliably reachable from a dev box. It serves fixture data from
  `test/res/paras.json`, recomputing each paragraph's `text_sha256` at load time instead of
  trusting the file's stored value (some are stale), plus 1200 synthesized entries for pagination
  tests.
- `services/sts/sts.service.spec.ts` - the original STS embedder.


## Algorithm

On a new event we get the opus id, we get all the paragraphs.

For each chunk of paragraphs, identify those that have not been already stored by getting
the existing sha256's in the db. Those that are already uploaded will not be uploaded again.

Todo:
- what happens when sha256 does not change but url does?
- several url's can have the same content. we don't really want to store the same vector multiple times. what do we do  ?
- some URLs may have disappeared, following often times the document's reorganization (stanzas reunited etc.) make sure TeiElems that are no longer are also removed from the Milvus db.
- if you move a paragraph into a subchapter (make it h3 instead of h2) -- only the URL changes. So the content and its sha256 stays the same but the URL should be updated (otherwise it will even become stale, pointing to nothing in reality)
-  a second case would be that of a paragraph which is duplicate.
-  upsert on sha256 is maybe the best case.

So maybe the following algorithms:
-  a check on both sha256 url and url -- those records need not be touched.
-  where only sha256 is the same, the url gets updated
-  otherwise, insert.
-
