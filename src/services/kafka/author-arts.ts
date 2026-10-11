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
