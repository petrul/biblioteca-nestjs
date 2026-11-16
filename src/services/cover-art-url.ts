/**
 * Source-bundled author portraits were removed from biblioteca-server. Keep
 * rejecting their old URLs as well: old author_media rows or cached API
 * responses must not make a deleted `/img/authors/...` file a cover candidate.
 */
export function isEligibleCoverArtUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  const raw = value.trim();
  let path = raw;
  try { path = new URL(raw, 'http://biblioteca.invalid').pathname; } catch { /* relative data is handled below */ }
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
