import { coverCandidateFor } from './author-arts';

/** The cover art falls back from the author's images to the work's own. */
describe('coverCandidateFor art', () => {
  const tbcWith = (author: any) => ({ getAuthor: async () => author }) as any;
  const opus = (imageUrls?: string[]) => ({ id: 7, path: 'anon/x', head: 'X', author: { strId: 'anon', displayName: 'Anonymous' }, imageUrls });

  it('takes one of the author images when there are any', async () => {
    const candidate = await coverCandidateFor(tbcWith({ imageUrls: ['https://a/portrait.jpg'] }), opus(['https://w/work.jpg']));
    expect(candidate.artUrl).toBe('https://a/portrait.jpg');
  });

  it('falls back to one of the work images when the author has none', async () => {
    const candidate = await coverCandidateFor(tbcWith({ imageUrls: [] }), opus(['https://w/work.jpg']));
    expect(candidate.artUrl).toBe('https://w/work.jpg');
  });

  it('has no art at all when neither has any image', async () => {
    const candidate = await coverCandidateFor(tbcWith({}), opus());
    expect(candidate.artUrl).toBeUndefined();
  });
});
