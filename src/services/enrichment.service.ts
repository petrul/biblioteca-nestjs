import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { BibliotecaClient } from './biblioteca_client.service';
import { AppConfService, PROVIDER_CONF } from '../configuration';
import { CoverEnrichmentService } from './cover-enrichment.service';

type WikiSummary = {
    extract?: string;
    originalimage?: { source?: string };
    thumbnail?: { source?: string };
    wikibase_item?: string;
};

/** Everything the enrichment worker may write back to biblioteca-server. */
type EnrichmentUpdate = {
    authorStrId?: string;
    opusId?: number;
    bio?: string;
    bioSourceUrl?: string;
    summary?: string;
    significantQuote?: string;
    birthDate?: string;
    deathDate?: string;
    birthPlace?: string;
    country?: string;
    writingLanguage?: string;
    imageUrls?: string[];
};

/**
 * Background enrichment, moved here from biblioteca-server's Java
 * EnrichmentService: a short author bio and opus summary, plus structured
 * author facts, taken from Wikipedia's REST summary API and the Wikidata
 * entity it links - no LLM rewrite, no image bytes downloaded. The server
 * keeps only the narrow idempotent persistence boundary
 * (POST /api/internal/enrichment), so this worker owns all the
 * external-call logic and its failure modes.
 *
 * Never touches the vector store, in either direction. Vectors are
 * precious (see the README's "Vectors are precious" section): no code path
 * here - and no code path anywhere in this worker outside the explicit
 * manual admin endpoints - may drop, truncate or recreate a vector
 * collection. Enrichment only ever ADDS metadata (bio/summary/facts/
 * images) that lives in the relational DB, a completely separate store.
 */
@Injectable()
export class EnrichmentService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(EnrichmentService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  // The same values as biblioteca-server's Languages enum (the generated
  // client inlines them as unions, there is no shared type to import).
  private static readonly LANGUAGES = new Set([
    'BG', 'BR', 'CA', 'DA', 'DE', 'EN', 'ES', 'FI', 'FR',
    'GR', 'HU', 'IT', 'LA', 'NL', 'NO', 'PT', 'RO', 'RU', 'ZH',
  ]);

  // Wikimedia's API etiquette REQUIRES a descriptive User-Agent on every
  // request - without one both the REST summary API and Wikidata answer
  // with a flat 403 instead of a real response.
  private static readonly USER_AGENT =
    'Biblioteca-/1.0 (https://biblioteca.scriptorium.ro; TEI library)';

  // Cuts at the last sentence boundary (. ! ?) at or before the limit,
  // rather than mid-sentence - a clean-ish first few paragraphs, not a
  // word chopped in half. Same rule as the retired Java service.
  private static readonly MAX_MATERIAL_CHARS = 1200;

  // Same cap as biblioteca-server's EnrichmentRestController
  // (MAX_ENRICHMENT_IMAGES): the server slices imageUrls at 3 when
  // persisting the media associations, so sending more is wasted payload.
  private static readonly MAX_IMAGES = 3;

  constructor(
    private readonly client: BibliotecaClient,
    @Inject(PROVIDER_CONF) private readonly conf: AppConfService,
    @Optional() private readonly covers?: CoverEnrichmentService,
  ) {}

  onModuleInit() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    this.timer = setTimeout(() => { void this.dailySweep(); this.timer = setInterval(() => void this.dailySweep(), 24 * 60 * 60 * 1000); }, next.getTime() - now.getTime());
    this.log.log(`daily enrichment sweep scheduled for ${next.toISOString()}`);
  }

  /** Whether an enrichment run (the daily sweep or a manual admin run) is executing. */
  isRunning(): boolean { return this.running; }

  /**
   * The single-flight lock shared by dailySweep() and the manual admin
   * runs (EnrichmentAdminService): only one enrichment pass over the
   * corpus may walk authors/opera at a time, whatever started it.
   */
  tryBeginRun(): boolean {
    if (this.running) return false;
    this.running = true;
    return true;
  }

  endRun(): void { this.running = false; }

  onModuleDestroy() { if (this.timer) { clearTimeout(this.timer); clearInterval(this.timer); } }

  /**
   * Once a day at 03:00, every not-yet-enriched author and opus - no
   * batch cap (was 25 of each; with the per-opus enrichment listener now
   * covering steady-state imports, this sweep only needs to be a
   * backstop, not a slow trickle). Idempotent by construction on both
   * ends: the worker only picks entities whose bio/summary is missing,
   * and the server's persistence endpoint only fills blank fields - so a
   * crashed sweep rerun never overwrites anything. One entity failing
   * never aborts the rest of the sweep.
   */
  async dailySweep() {
    if (!this.tryBeginRun()) return;
    try {
      // Authors first, and not just for their bios: the art retrieved
      // here is the fallback for covers whose opus has no art of its own
      // (see the opus loop below), so it must be in hand before the first
      // cover is ordered. Authors already enriched in a previous run are
      // skipped without their art being recalled - covers for their
      // opera then order art-less unless the opus itself yields art.
      const authors = await this.client.getAuthors();
      const artByAuthor = new Map<string, string>();
      for (const author of (authors as any[]).filter(a => !a.bio)) {
        try {
          this.log.log(`enrichment candidate author ${author.strId}`);
          const images = await this.enrichAuthor(author);
          if (images?.length) artByAuthor.set(author.strId, images[0]);
        } catch (e: any) {
          this.log.warn(`author enrichment failed for ${author.strId}: ${e?.message ?? e}`);
        }
      }
      // getAllOpera(pageNr, pageSize) is one page only - allOperaGen()
      // paginates through every opus on the server, not just the first
      // page, now that nothing here caps how many get considered.
      // Already-enriched check: this SDR findOpera projection never
      // carries the work-level description and quote from TeiOpus. Either
      // value is enough to identify a completed enrichment.
      for await (const opus of this.client.allOperaGen()) {
        // Work enrichment runs BEFORE the cover is ordered: the graphics
        // this pass just retrieved (the article's lead image, the
        // Wikidata entity's Commons art) are threaded into the order as
        // coverArtUrl. Ordering first would render a text-only cover and
        // freeze it - covers are fill-only, an existing coverUrl is never
        // re-rendered.
        let artUrl: string | undefined;
        if (!(opus as any).description && !(opus as any).significantQuote) {
          try {
            this.log.log(`enrichment candidate work ${(opus as any).id} ${(opus as any).head}`);
            const images = await this.enrichWork(opus);
            artUrl = images?.[0];
          } catch (e: any) {
            this.log.warn(`opus enrichment failed for ${(opus as any).id} ${(opus as any).head}: ${e?.message ?? e}`);
          }
        }
        if (this.covers && (opus as any).id && (opus as any).completePath && (opus as any).head) {
          const authorStrId = (opus as any).author?.strId;
          this.covers.enqueue({
            id: (opus as any).id,
            path: (opus as any).completePath,
            title: (opus as any).head,
            author: (opus as any).author?.visualName || (opus as any).author?.displayName || 'Anonymous',
            coverUrl: (opus as any).coverUrl,
            // the work's own art when this pass found any, else its author's portrait
            artUrl: artUrl || (authorStrId ? artByAuthor.get(authorStrId) : undefined),
          });
        }
      }
    } catch (e: any) { this.log.warn(`daily enrichment sweep failed: ${e?.message ?? e}`); }
    finally { this.endRun(); }
  }

  /**
   * @param opts.force re-enriches an already-enriched author instead of
   * skipping them - the explicit overwrite switch of the manual admin
   * runs (EnrichmentAdminService). The default, and every automatic
   * caller (daily sweep, Kafka listener), keeps the fill-only invariant:
   * an author with a bio is never touched again.
   *
   * @returns the image URLs persisted for the author (lead image plus
   * the Wikidata entity's Commons art), most representative first;
   * undefined when the author was skipped or no article was found. The
   * callers thread the first URL into the cover order as coverArtUrl.
   */
  async enrichAuthor(author: any, opts: { force?: boolean } = {}): Promise<string[] | undefined> {
    const name = author.displayName || [author.firstName, author.lastName].filter(Boolean).join(' ');
    if (!name || (author.bio && !opts.force)) return undefined;
    const page = await this.wikipedia(name);
    if (!page?.extract) return undefined;
    // The Wikidata entity behind the article is fetched once and read
    // twice: the structured facts for the bio fields, and its P18
    // (image) claims for extra art beyond the article's lead image.
    const claims = await this.wikidataClaims(page.wikibase_item);
    const update: EnrichmentUpdate = {
      authorStrId: author.strId,
      bio: this.truncateMaterial(page.extract),
      bioSourceUrl: this.wikipediaUrl(name),
      ...await this.wikidataFacts(claims),
      imageUrls: this.images(page, claims),
    };
    await this.persist(update, opts);
    return update.imageUrls;
  }

  /**
   * Same force semantics as enrichAuthor above: default fills only what
   * is missing. Also returns the persisted image URLs - the article's
   * lead image plus the work entity's own P18 Commons art (a scan, a
   * famous painting of the scene) - for the cover order.
   */
  async enrichWork(opus: any, opts: { force?: boolean } = {}): Promise<string[] | undefined> {
    if (!opus?.id || !opus.head || ((opus.description || opus.significantQuote) && !opts.force)) return undefined;
    const page = await this.wikipedia(opus.head);
    if (!page?.extract) return undefined;
    const claims = await this.wikidataClaims(page.wikibase_item);
    const imageUrls = this.images(page, claims);
    await this.persist({
      opusId: opus.id,
      summary: this.truncateMaterial(page.extract),
      imageUrls,
    }, opts);
    return imageUrls;
  }

  /**
   * Wikipedia's own REST summary API (docs: en.wikipedia.org/api/rest_v1/)
   * - a pre-written, clean plain-text extract, no HTML scraping. English
   * first (full i18n of the stored text is a later concern); a native-
   * language article found via search would be the obvious refinement.
   */
  private async wikipedia(title: string): Promise<WikiSummary | null> {
    return this.fetchJson<WikiSummary>(this.wikipediaApiUrl(title));
  }

  /**
   * The claims of the Wikidata entity behind the selected Wikipedia
   * article, fetched once and shared by the fact extraction and the
   * image harvesting below. Best-effort: any failure yields undefined
   * and the callers proceed without facts/art.
   */
  private async wikidataClaims(wikibaseItem?: string): Promise<any | undefined> {
    try {
      if (!wikibaseItem) return undefined;
      return await this.fetchJson<any>(`https://www.wikidata.org/wiki/Special:EntityData/${wikibaseItem}.json`)
        .then((root: any) => root?.entities?.[wikibaseItem]?.claims ?? {});
    } catch (e: any) {
      this.log.log(`no Wikidata entity (${wikibaseItem}): ${e?.message ?? e}`);
      return undefined;
    }
  }

  /**
   * Structured author facts from those claims: birth/death dates
   * (P569/P570), birth place and country (P19/P27, resolved to their
   * labels), and the author's writing languages (P1412, mapped through
   * each language entity's own ISO 639-1 code, P218). Best-effort: any
   * failure leaves the fields unset, and the server only fills blanks
   * anyway.
   */
  private async wikidataFacts(claims: any): Promise<Partial<EnrichmentUpdate>> {
    try {
      if (!claims) return {};
      const birthPlaceId = this.firstEntityId(claims.P19);
      const countryId = this.firstEntityId(claims.P27);
      const languageIds: string[] = this.entityIds(claims.P1412);
      const labels = await this.wikidataLabels([birthPlaceId, countryId, ...languageIds].filter(Boolean));
      const writingLanguage = await this.writingLanguage(languageIds);
      return {
        birthDate: this.claimTime(claims.P569),
        deathDate: this.claimTime(claims.P570),
        birthPlace: labels[birthPlaceId!],
        country: labels[countryId!],
        ...(writingLanguage ? { writingLanguage } : {}),
      };
    } catch (e: any) {
      this.log.log(`no Wikidata facts: ${e?.message ?? e}`);
      return {};
    }
  }

  /** Labels for a set of entity ids, English first, Romanian fallback. */
  private async wikidataLabels(ids: string[]): Promise<Record<string, string>> {
    if (!ids.length) return {};
    const url = 'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json'
      + `&props=labels&languages=en%7Cro&ids=${ids.map(encodeURIComponent).join('|')}`;
    const entities = (await this.fetchJson<any>(url))?.entities ?? {};
    const labels: Record<string, string> = {};
    for (const id of ids) {
      const label = entities[id]?.labels?.en?.value ?? entities[id]?.labels?.ro?.value;
      if (label) labels[id] = label;
    }
    return labels;
  }

  /** The author's writing language as the server's Languages enum name. */
  private async writingLanguage(languageIds: string[]): Promise<string | undefined> {
    for (const id of languageIds) {
      try {
        const claims = await this.fetchJson<any>(`https://www.wikidata.org/wiki/Special:EntityData/${id}.json`)
          .then((root: any) => root?.entities?.[id]?.claims ?? {});
        const code = this.firstClaimValue(claims.P218)?.toString().toUpperCase();
        if (code && EnrichmentService.LANGUAGES.has(code)) return code;
      } catch { /* try the next language entity */ }
    }
    return undefined;
  }

  /**
   * A Wikidata time claim as a plain date, honoring the claim's precision:
   * year for precision <= 9, year-month for 10, full date for 11+ (raw
   * values look like "+1850-01-15T00:00:00Z").
   */
  private claimTime(claim: any[]): string | undefined {
    const value = this.firstClaimValue(claim);
    if (!value || typeof value.time !== 'string') return undefined;
    const precision = typeof value.precision === 'number' ? value.precision : 11;
    const date = value.time.replace(/^\+/, '').slice(0, 10);
    if (date.length < 4) return undefined;
    if (precision <= 9) return date.slice(0, 4);
    if (precision === 10) return date.slice(0, Math.min(7, date.length));
    return date;
  }

  private firstEntityId(claim: any[]): string | undefined {
    const value = this.firstClaimValue(claim);
    return typeof value?.id === 'string' ? value.id : undefined;
  }

  private entityIds(claim: any[]): string[] {
    return this.claimValues(claim).map((v: any) => v?.id).filter((id: any): id is string => typeof id === 'string');
  }

  private firstClaimValue(claim: any[]): any {
    return this.claimValues(claim)[0];
  }

  private claimValues(claim: any[]): any[] {
    return (claim ?? []).map((c: any) => c?.mainsnak?.datavalue?.value).filter(Boolean);
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10 * 1000);
    try {
      const response = await fetch(url, { headers: { 'User-Agent': EnrichmentService.USER_AGENT }, signal: controller.signal });
      return response.ok ? await response.json() as T : null;
    } catch { return null; }
    finally { clearTimeout(timeout); }
  }

  /**
   * The persistence call. Routed through the shared bibliotecaUrl but on
   * plain fetch for now: the endpoint postdates the generated client
   * (biblioteca.api.ts) - once that is regenerated this should move onto
   * the generated Api like every other server call.
   *
   * The payload always carries an explicit overwrite flag, so the
   * server-side contract stays one rule with no ambiguity: overwrite
   * false (the default for every automatic caller) means fill blanks
   * only - existing values are never touched; overwrite true - sent only
   * by a manual admin run whose request said so - means this single
   * update replaces already-populated fields.
   */
  private async persist(body: EnrichmentUpdate, opts: { force?: boolean } = {}) {
    const response = await fetch(`${this.conf.bibliotecaUrl}/api/internal/enrichment`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ ...body, overwrite: opts.force === true }) });
    if (!response.ok) throw new Error(`enrichment persistence returned HTTP ${response.status}`);
  }

  private wikipediaApiUrl(title: string) { return `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, '_'))}`; }
  private wikipediaUrl(title: string) { return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`; }
  private image(page: WikiSummary) { const url = page.originalimage?.source || page.thumbnail?.source; return url ? [url] : []; }

  /**
   * The entity's art, most representative first: the article's lead
   * image, then every P18 (image) claim of the linked Wikidata entity.
   * P18 values are Commons file titles, turned into Special:FilePath
   * URLs - image URLs only, never bytes: the server stores the URL as a
   * media association (up to MAX_IMAGES, matching its own
   * EnrichmentRestController cap) and the covers renderer downloads the
   * chosen one itself when a cover is actually rendered.
   */
  private images(page: WikiSummary, claims?: any): string[] {
    const urls: string[] = [];
    for (const url of [...this.image(page), ...this.commonsImages(claims)]) {
      if (url && !urls.includes(url)) urls.push(url);
    }
    return urls.slice(0, EnrichmentService.MAX_IMAGES);
  }

  private commonsImages(claims: any): string[] {
    return this.claimValues(claims?.P18)
      .map((value: any) => this.commonsFilePath(String(value)))
      .filter(Boolean);
  }

  private commonsFilePath(fileName: string): string | undefined {
    if (!fileName) return undefined;
    // Special:FilePath redirects to the real upload.wikimedia.org image;
    // the width cap keeps the renderer from pulling Commons originals,
    // which are routinely tens of megabytes.
    const title = fileName.replace(/^File:/, '').trim();
    if (!title) return undefined;
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title.replace(/\s/g, '_'))}?width=1200`;
  }

  private truncateMaterial(material: string) {
    if (material.length <= EnrichmentService.MAX_MATERIAL_CHARS) return material;
    const window = material.slice(0, EnrichmentService.MAX_MATERIAL_CHARS);
    const lastSentenceEnd = Math.max(window.lastIndexOf('.'), window.lastIndexOf('!'), window.lastIndexOf('?'));
    return lastSentenceEnd > EnrichmentService.MAX_MATERIAL_CHARS / 2 ? window.slice(0, lastSentenceEnd + 1) : window;
  }
}
