/**
 * Source-bundled author portraits were removed from biblioteca-server. Keep
 * rejecting their old URLs as well: old author_media rows or cached API
 * responses must not make a deleted `/img/authors/...` file a cover candidate.
 */
export function isEligibleCoverArtUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  const raw = value.trim();
  // Explicit admin uploads are data URLs; all enriched artwork must be an
  // absolute HTTP(S) URL. Relative paths and localhost URLs are old bundled
  // assets, not remotely enriched media, and the renderer correctly refuses
  // them as private/non-public addresses.
  if (/^data:/i.test(raw)) return true;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  if (/^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)$/i.test(parsed.hostname)) return false;
  const path = parsed.pathname;
  return !/(^|\/)img\/authors(?:\/|$)/i.test(path)
    && !/(^|\/)authors(?:\/|$)/i.test(path);
}

/**
 * Old cover request JSON can still be stored beside a rendered PNG.  Do not
 * offer a deleted source portrait back to the admin editor when that JSON is
 * read again; an external enrichment URL (or an explicitly uploaded data URL)
 * remains untouched.
 */
export function withoutLegacyCoverArtUrl(request: Record<string, unknown>): Record<string, unknown> {
  if (request.coverArtUrl === undefined || isEligibleCoverArtUrl(request.coverArtUrl)) return request;
  const { coverArtUrl: _removed, ...clean } = request;
  return clean;
}
