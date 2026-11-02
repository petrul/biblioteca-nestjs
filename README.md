# Biblioteca NestJS

The background worker of [Biblioteca](https://biblioteca.scriptorium.ro). It
does the slow, GPU-bound work, so that the server that serves readers never
waits on it:

- **Vectorizes** every paragraph of every work into Qdrant (bge-m3 via
  Ollama), for biblioteca-server's semantic search.
- **Enriches** the catalogue: author bios and facts, work summaries, and
  covers rendered by biblioteca-covers and stored in MinIO.
- **Answers questions** about the library, a book or a collection: hybrid
  search, retrieval-augmented answers and chat (`/api/rag/*`), built on
  its own framework, *ragtime*.

```
biblioteca-server ──Kafka: work imported──▶ biblioteca-nestjs ──▶ Qdrant (vectors)
        ▲                                      │  │        └──▶ Ollama (embeddings, chat)
        └──── REST: paragraphs, config, ───────┘  └──▶ biblioteca-covers ──▶ MinIO
              enrichment results
biblioteca-reader ──/vz/api (chat, status)──▶ biblioteca-nestjs
```

## Quick start

Every Biblioteca project has the same Rake interface. The tasks load the
`biblioteca/<profile>` pass-store profile, by default the machine's
hostname:

```bash
rake run              # npm run start, on http://localhost:3334 (PORT overrides)
rake "run[zmeu]"      # with an explicit profile
rake test             # jest; most specs use fakes, a few talk to live Ollama/Qdrant
rake ci               # clean, install, test with the ci profile, build, publish the Docker image
rake gen-client       # regenerate src/biblioteca.api.ts from a running biblioteca-server
```

Needs Node, plus reachable Kafka, Qdrant, Ollama and biblioteca-server (it
reads its shared configuration from the server at startup, and waits until
the server is up). Look for `listening on Kafka topics` in the log. The
Swagger UI is at `/api/ui`.

## Configuration

[`.env.example`](.env.example) lists the variables, using the pass-store
names the whole family shares:

| Variable | Purpose |
| --- | --- |
| `KAFKA_BROKERS` | Kafka brokers |
| `OLLAMA_URL` | Ollama, for embeddings and chat |
| `VECTORSTORE_URL` | Qdrant URL with port (`VECTOR_STORE=qdrant` is the default) |
| `BIBLIOTECA_EXTERNAL_URL` | biblioteca-server, read for content and shared config |
| `COVERS_API_URL` | biblioteca-covers (default `http://localhost:3335`) |
| `MINIO_URL`, `MINIO_CREDS` | Cover storage: endpoint plus bucket, and `access-key:secret-key` |
| `BIBLIOTECA_INTERNAL_API_TOKEN` | Required by the state-changing admin endpoints (`Authorization: Bearer ...`) |

**Topic, collection, model and paragraph window are not configured here**:
they come from biblioteca-server's `GET /api/admin/config`, so the two cannot
disagree. See [docs/vectors.md](docs/vectors.md).

## How it works

- **Vectorizing.** On each "work imported" event the worker reads the work's
  paragraphs from biblioteca-server and embeds only those whose sha256 has no
  stored vector. A renamed book is repointed, not re-embedded. **Nothing ever
  drops vectors automatically**, because rebuilding them takes days. See
  [docs/vectors.md](docs/vectors.md).
- **Enrichment.** Kafka listeners plus a daily 03:00 sweep fill missing author
  bios, work summaries, covers and vectors. Every step is fill-only unless a
  manual run asks for `overwrite`. See [docs/enrichment.md](docs/enrichment.md).
- **Search, ask, chat.** Questions are searched with the question and a
  drafted answer (HyDE), by vectors and keywords, then reranked by the chat
  model before answering with `[n]` citations. See
  [docs/ragtime.md](docs/ragtime.md).
- **Events.** Every chat, question and RAG search is published on
  `biblioteca_events` with its user. The topic names and message schemas are
  in biblioteca-server's `asyncapi.yml`.
- **Initiator.** Every log line names who caused it, taken from the
  initiator header the reader and server send (`src/initiator.ts`).

| Path | What's there |
| --- | --- |
| `src/app.module.ts` | The wiring: start here to see how everything connects |
| `src/configuration.ts` | Environment variables and the shared-config shape |
| `src/services/kafka/` | Kafka consumers (vectorizing, author and work enrichment) and the producer |
| `src/services/vectorizer.service.ts` | Vectorizing a work |
| `src/services/*enrichment*` | Enrichment, covers, the manual admin runs |
| `src/services/events/` | Publishing human events on `biblioteca_events` |
| `src/ragtime/core/` | The generic framework; imports nothing outside itself (`extractable.spec.ts` enforces it) |
| `src/ragtime/adapters/` | Qdrant, Ollama, Cassandra, website crawler |
| `src/biblioteca-rag/` | Biblioteca on ragtime, and the `/api/rag` controller |
| `src/biblioteca.api.ts` | Generated biblioteca-server client (`rake gen-client`) |
| `test/` | Fakes and fixtures used in place of a live server |

## API

The admin endpoints that change state (POSTs to vectorizing, enrichment,
covers, vector-store) need `Authorization: Bearer $BIBLIOTECA_INTERNAL_API_TOKEN`.

| Endpoint | What it does |
| --- | --- |
| `GET /api/info`, `GET /api/status` | Version; status, including the vectorizing job |
| `GET /api/vectorizing` | The bulk vectorizing job: state and progress |
| `POST /api/vectorizing/{start,pause,resume}` | Run, pause or resume the bulk job (`start?shuffle=`); never truncates |
| `POST /api/vector-store/remove-opus`, `.../reset` | **Manual-only** drops of one work's vectors, or of the whole collection |
| `GET /api/enrichment/modules` | The enrichment steps: author, work, cover, vectorize |
| `POST /api/enrichment/run`, `.../run/dry-run` | A manual enrichment job (202 + job id), or the list of what it would do |
| `GET /api/enrichment/jobs[/:id]`, `POST .../:id/cancel` | Follow or cancel enrichment jobs |
| `GET /api/enrichment/author/:strId`, `.../work?path=` | What one author or work already has |
| `POST /api/covers/work`, `/api/covers/run...` | Render one work's cover now, or run cover jobs |
| `POST /api/rag/search` | The passages nearest in meaning to `query`, within `scope.opusPaths` (a book, a collection, or everything) |
| `POST /api/rag/ask`, `.../ask/stream` | An answer citing passages as `[n]`; the stream sends passages, `{"delta"}` chunks, `{"done": true}` |
| `POST /api/rag/chat` | The next turn of a conversation (`conversationId`; held in memory) |

`/api/rag/*` has no rate limit of its own. It is reached only through
biblioteca-reader, whose chat gate admits signed-in users one message at a
time. biblioteca-reader generates `src/generated/vectorizer-api.d.ts` from this
service's OpenAPI document (`/api/ui-json`), so when this API changes, run
`rake gen-vectorizer-client` there against a running instance.

## Tests

- `src/ragtime/core/*.spec.ts` - the framework on in-memory doubles.
- `src/biblioteca-rag/rag.service.spec.ts` - search, ask, chat and streaming
  over a fake library.
- `src/services/vector_reuse.spec.ts` - reuse by sha256 and url repointing.
- `*.integration.spec.ts` - live Qdrant (own `test_*` collections) and Ollama.
  `novel-chat.integration.spec.ts` chats with *A Christmas Carol*; these take
  longer, and the live model can occasionally fail them.

## License

Copyright 2026 Editii Scriptorium srl. Licensed under the [Apache License, Version 2.0](LICENSE); see also [NOTICE](NOTICE).
