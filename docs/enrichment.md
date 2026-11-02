# Enrichment: bios, summaries, covers

Four enrichment steps fill what the corpus lacks: author bios and facts,
work summaries, cover art, and vectors. They run off the Kafka import topics
(each listener in its own consumer group, so none steals another's events)
and a daily 03:00 sweep, and can be rerun by hand through
`/api/enrichment/*`.

## Covers

After a successful opus-import event, the NestJS worker schedules cover
generation in the background. It calls `biblioteca-covers`, writes the PNG to
the configured MinIO bucket under `covers/`, and persists only the public URL
on the opus. Jobs are deduplicated by the canonical `authorId/opusId` path and
never run in the reader request path. A missing or failed cover is harmless:
the reader uses its bundled default cover.

Configure `COVERS_API_URL`, `MINIO_URL` and `MINIO_CREDS`; credentials stay
server-side.

The cover-cache variables mean:

```dotenv
# MinIO S3/API endpoint, with the bucket as the URL path.
MINIO_URL=http://srv2.local:20124/biblioteca
# access-key:secret-key (example only; never commit a real credential).
MINIO_CREDS=example-cover-cache-access-key:example-cover-cache-secret-key
```

`MINIO_URL` is used as both the S3/API endpoint and the base URL for public
objects. `MINIO_CREDS` is split at the first colon. Both values stay server-side.

## Manual enrichment admin (`/api/enrichment/*`)

The four enrichment steps - author bio/facts, work summary, cover art,
vectorization - run automatically off the Kafka import topics and the daily
03:00 sweep. The `/api/enrichment/*` surface is the explicit manual way to
retrigger them integrally or partially, designed to be driven entirely from
the Swagger UI at `/api/ui` (`GET modules` lists what exists; the run
endpoints carry ready-made named examples in their request body).

The invariant the surface is built around: **every step is fill-only by
default** - it only enriches what is not enriched yet, and existing data is
never touched. For covers, "enriched" means verified, not merely present:
a stored `coverUrl` whose MinIO object is missing - or holds a non-image
body - counts as unenriched and the cover is re-rendered (one ranged read
per stored URL, asked by `CoverEnrichmentService.hasUsableCover` from the
Kafka work-enrichment listener and the manual run alike). That is enforced in three independent layers, so a bug in one
cannot destroy anything: candidate selection (an enriched entity never even
becomes a candidate), the guards inside the enrichment/cover services
themselves, and biblioteca-server's persistence endpoint, which fills blank
fields unless the single update's payload carries `overwrite: true`.

`overwrite: true` is the one explicit switch - per request, never sticky,
rejected for the vectorize step (vectorization is fill-only by construction:
stored sha256s are reused, nothing is dropped). Manual runs and the daily
sweep share one single-flight lock, so they never walk the corpus at the same
time. Jobs are async (the run answers 202 with a job id), cancel is
cooperative, and `POST /api/enrichment/run/dry-run` lists the candidates
without making a single external call.
