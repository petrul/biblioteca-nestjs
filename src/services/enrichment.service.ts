import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BibliotecaClient } from './biblioteca_client.service';
import { AppConfService, PROVIDER_CONF } from '../configuration';

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
    summarySourceUrl?: string;
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
    'Biblioteca-NestJS-Enrichment/1.0 (https://biblioteca.scriptorium.ro; self-hosted TEI library)';

  // Cuts at the last sentence boundary (. ! ?) at or before the limit,
  // rather than mid-sentence - a clean-ish first few paragraphs, not a
  // word chopped in half. Same rule as the retired Java service.
  private static readonly MAX_MATERIAL_CHARS = 1200;

  constructor(private readonly client: BibliotecaClient, @Inject(PROVIDER_CONF) private readonly conf: AppConfService) {}

  onModuleInit() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    this.timer = setTimeout(() => { void this.dailySweep(); this.timer = setInterval(() => void this.dailySweep(), 24 * 60 * 60 * 1000); }, next.getTime() - now.getTime());
    this.log.log(`daily enrichment sweep scheduled for ${next.toISOString()}`);
  }

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
    if (this.running) return;
    this.running = true;
    try {
      const authors = await this.client.getAuthors();
      for (const author of (authors as any[]).filter(a => !a.bio)) {
        try {
          this.log.log(`enrichment candidate author ${author.strId}`);
          await this.enrichAuthor(author);
        } catch (e: any) {
          this.log.warn(`author enrichment failed for ${author.strId}: ${e?.message ?? e}`);
        }
      }
      // getAllOpera(pageNr, pageSize) is one page only - allOperaGen()
      // paginates through every opus on the server, not just the first
      // page, now that nothing here caps how many get considered.
      for await (const opus of this.client.allOperaGen()) {
        if ((opus as any).summary) continue;
        try {
          this.log.log(`enrichment candidate work ${(opus as any).id} ${(opus as any).head}`);
          await this.enrichWork(opus);
        } catch (e: any) {
          this.log.warn(`opus enrichment failed for ${(opus as any).id} ${(opus as any).head}: ${e?.message ?? e}`);
        }
      }
    } catch (e: any) { this.log.warn(`daily enrichment sweep failed: ${e?.message ?? e}`); }
    finally { this.running = false; }
  }

  async enrichAuthor(author: any) {
    const name = author.displayName || [author.firstName, author.lastName].filter(Boolean).join(' ');
    if (!name || author.bio) return;
    const page = await this.wikipedia(name);
    if (!page?.extract) return;
    const facts = await this.wikidataFacts(page.wikibase_item);
    const update: EnrichmentUpdate = {
      authorStrId: author.strId,
      bio: this.truncateMaterial(page.extract),
      bioSourceUrl: this.wikipediaUrl(name),
      ...facts,
      imageUrls: this.image(page),
    };
    await this.persist(update);
  }

  async enrichWork(opus: any) {
    if (!opus?.id || !opus.head || opus.summary) return;
    const page = await this.wikipedia(opus.head);
    if (!page?.extract) return;
    await this.persist({
      opusId: opus.id,
      summary: this.truncateMaterial(page.extract),
      summarySourceUrl: this.wikipediaUrl(opus.head),
      imageUrls: this.image(page),
    });
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
   * Structured author facts from the Wikidata entity behind the selected
   * Wikipedia article: birth/death dates (P569/P570), birth place and
   * country (P19/P27, resolved to their labels), and the author's
   * writing languages (P1412, mapped through each language entity's own
   * ISO 639-1 code, P218). Best-effort: any failure leaves the fields
   * unset, and the server only fills blanks anyway.
   */
  private async wikidataFacts(wikibaseItem?: string): Promise<Partial<EnrichmentUpdate>> {
    try {
      if (!wikibaseItem) return {};
      const claims = await this.fetchJson<any>(`https://www.wikidata.org/wiki/Special:EntityData/${wikibaseItem}.json`)
        .then((root: any) => root?.entities?.[wikibaseItem]?.claims ?? {});
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
      this.log.log(`no Wikidata facts (${wikibaseItem}): ${e?.message ?? e}`);
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
   */
  private async persist(body: EnrichmentUpdate) {
    const response = await fetch(`${this.conf.bibliotecaUrl}/api/internal/enrichment`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`enrichment persistence returned HTTP ${response.status}`);
  }

  private wikipediaApiUrl(title: string) { return `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, '_'))}`; }
  private wikipediaUrl(title: string) { return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`; }
  private image(page: WikiSummary) { const url = page.originalimage?.source || page.thumbnail?.source; return url ? [url] : []; }

  private truncateMaterial(material: string) {
    if (material.length <= EnrichmentService.MAX_MATERIAL_CHARS) return material;
    const window = material.slice(0, EnrichmentService.MAX_MATERIAL_CHARS);
    const lastSentenceEnd = Math.max(window.lastIndexOf('.'), window.lastIndexOf('!'), window.lastIndexOf('?'));
    return lastSentenceEnd > EnrichmentService.MAX_MATERIAL_CHARS / 2 ? window.slice(0, lastSentenceEnd + 1) : window;
  }
}
