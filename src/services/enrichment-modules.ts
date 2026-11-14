/**
 * The catalog of enrichment modules - the single source of truth for three
 * consumers that must never drift apart:
 *
 * - GET /api/enrichment/modules serves it verbatim ("what is available"),
 * - EnrichmentAdminService validates POST /api/enrichment/run's steps
 *   against it (an unknown step is a 400 before any external call),
 * - the Swagger UI enum for the run request's steps field is derived from
 *   it, so the dropdown and the runtime validation are the same list.
 *
 * Every module is fill-only by default: it only touches entities whose
 * enrichment data is missing. The run request's explicit overwrite switch
 * (default off) is the only way to re-enrich, and only for the modules
 * whose overwrite flag is true here.
 */
export interface EnrichmentModule {
  id: 'author' | 'work' | 'cover' | 'vectorize' | 'cache';
  title: string;
  /** One-liner of what the module actually does, served to Swagger UI. */
  description: string;
  /** The biblioteca-server fields this module may fill. */
  fills: string[];
  /**
   * Whether the run request's overwrite switch applies. False means the
   * module is fill-only by construction and combining it with overwrite
   * is rejected with a 400.
   */
  overwrite: boolean;
}

export const ENRICHMENT_MODULES: EnrichmentModule[] = [
  {
    id: 'author',
    title: 'Author bio + Wikidata facts',
    description: "Wikipedia extract as the author's bio plus birth/death dates, birth place, country and writing language from the linked Wikidata entity.",
    fills: ['bio', 'bioSourceUrl', 'birthDate', 'deathDate', 'birthPlace', 'country', 'writingLanguage', 'imageUrls'],
    overwrite: true,
  },
  {
    id: 'work',
    title: 'Work summary (Wikipedia)',
    description: "The opus's Wikipedia extract stored as its summary (with its source URL), plus the work's own art - the article's lead image and its Wikidata Commons images - stored as the work's image URLs and preferred for its cover. Stamps workEnrichedAt even when no article exists.",
    fills: ['summary', 'summarySourceUrl', 'imageUrls', 'workEnrichedAt'],
    overwrite: true,
  },
  {
    id: 'cover',
    title: 'Cover art generation',
    description: 'Renders a work cover (archival monograph layout) and stores it in the MinIO cover cache; completion is asynchronous.',
    fills: ['coverUrl'],
    overwrite: true,
  },
  {
    id: 'vectorize',
    title: 'Text vectorization',
    description: 'Embeds one opus\'s paragraphs. Fill-only BY CONSTRUCTION: already-stored sha256s are reused and nothing is ever dropped ("vectors are precious"), so overwrite does not apply. Explicit opusPaths targets only - a full-corpus run belongs to POST /api/vectorizing/start.',
    fills: ['vectors'],
    overwrite: false,
  },
  {
    id: 'cache',
    title: 'Table-of-contents cache',
    description: "Builds the cached table of contents of every work that has none, one work at a time with a pause, so no reader waits for one (a large work's took seconds). The server builds it at import already; this is the backstop. Fill-only by construction: nothing is dropped or rebuilt, so overwrite does not apply. Whole corpus only.",
    fills: ['toc'],
    overwrite: false,
  },
];

export type EnrichmentStep = EnrichmentModule['id'];

export const ENRICHMENT_STEP_IDS: EnrichmentStep[] = ENRICHMENT_MODULES.map(m => m.id);
