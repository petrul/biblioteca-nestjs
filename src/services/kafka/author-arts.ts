import { BibliotecaClient } from '../biblioteca_client.service';

/**
 * The author's image URLs as the server associates them (images enrichment
 * persisted plus the bundled portrait), deduplicated - what a cover's art
 * is picked from at random, so a corpus does not repeat one portrait.
 */
export async function authorArts(tbc: BibliotecaClient, strId: string): Promise<string[]> {
  const author = await tbc.getAuthor(strId) as any;
  return [
    ...(Array.isArray(author?.imageUrls) ? author.imageUrls : []),
    ...(author?.image_href ? [author.image_href] : []),
  ].filter((url, i, all) => typeof url === 'string' && url.length > 0 && all.indexOf(url) === i);
}

/** One of the author's arts at random, or undefined. */
export async function randomAuthorArt(tbc: BibliotecaClient, strId: string): Promise<string | undefined> {
  const arts = await authorArts(tbc, strId);
  return arts.length ? arts[Math.floor(Math.random() * arts.length)] : undefined;
}

/**
 * The cover candidate for an opus as served by /api/divs: its title, its
 * author's display name and its art - one of the work's own images (stored
 * by work enrichment) at random, else one of the author's (none when
 * neither has any, or the media lookup fails - the cover then renders
 * without art, in the typographic layout).
 */
export async function coverCandidateFor(tbc: BibliotecaClient, opus: any, onArtError?: (error: any) => void) {
  const author = opus?.author;
  const workImages = (Array.isArray(opus?.imageUrls) ? opus.imageUrls : [])
    .filter((url: unknown) => typeof url === 'string' && url.length > 0);
  let artUrl: string | undefined = workImages.length
    ? workImages[Math.floor(Math.random() * workImages.length)]
    : undefined;
  if (!artUrl && author?.strId) {
    try {
      artUrl = await randomAuthorArt(tbc, author.strId);
    } catch (error: any) {
      onArtError?.(error);
    }
  }
  return {
    id: opus.id as number,
    path: opus.path as string,
    title: opus.head as string,
    author: (author?.displayName || author?.visualName || author?.strId || 'Anonymous') as string,
    coverUrl: opus.coverUrl as string | undefined,
    artUrl,
  };
}
