import { coverCandidateFor } from './author-arts';

/** The cover art: the work's own images first, then the author's. */
describe('coverCandidateFor art', () => {
  const tbcWith = (author: any) => ({ getAuthor: async () => author }) as any;
  const opus = (imageUrls?: string[]) => ({ id: 7, path: 'anon/x', head: 'X', author: { strId: 'anon', displayName: 'Anonymous' }, imageUrls });

  it('prefers one of the work images over the author portrait', async () => {
    const candidate = await coverCandidateFor(tbcWith({ imageUrls: ['https://a/portrait.jpg'] }), opus(['https://w/work.jpg']));
    expect(candidate.artUrl).toBe('https://w/work.jpg');
  });

  it('falls back to one of the author images when the work has none', async () => {
    const candidate = await coverCandidateFor(tbcWith({ imageUrls: ['https://a/portrait.jpg'] }), opus([]));
    expect(candidate.artUrl).toBe('https://a/portrait.jpg');
  });

  it('has no art at all when neither has any image', async () => {
    const candidate = await coverCandidateFor(tbcWith({}), opus());
    expect(candidate.artUrl).toBeUndefined();
  });
});
