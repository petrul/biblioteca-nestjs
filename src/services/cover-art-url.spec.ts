import { isEligibleCoverArtUrl, withoutLegacyCoverArtUrl } from './cover-art-url';

describe('cover art source policy', () => {
  it('rejects deleted source-bundled author portraits, including legacy absolute URLs', () => {
    expect(isEligibleCoverArtUrl('/img/authors/comnena.jpg')).toBe(false);
    expect(isEligibleCoverArtUrl('authors/comnena.jpg')).toBe(false);
    expect(isEligibleCoverArtUrl('http://localhost:8080/img/authors/comnena.jpg')).toBe(false);
  });

  it('keeps explicit external and data art eligible', () => {
    expect(isEligibleCoverArtUrl('https://upload.wikimedia.org/wikipedia/commons/a/a.jpg')).toBe(true);
    expect(isEligibleCoverArtUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isEligibleCoverArtUrl('http://localhost:8080/covers/local.jpg')).toBe(false);
    expect(isEligibleCoverArtUrl('/covers/local.jpg')).toBe(false);
  });

  it('removes a deleted local author portrait from stored cover JSON', () => {
    const request = { title: 'Alexiada', coverArtUrl: 'http://localhost:8080/img/authors/comnena.jpg', layout: 'folio_bauhaus' };
    expect(withoutLegacyCoverArtUrl(request)).toEqual({ title: 'Alexiada', layout: 'folio_bauhaus' });
    const external = { title: 'Alexiada', coverArtUrl: 'https://commons.wikimedia.org/a.jpg' };
    expect(withoutLegacyCoverArtUrl(external)).toBe(external);
  });
});
