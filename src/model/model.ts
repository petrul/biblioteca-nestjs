/**
 * these should be the basic subsystems
 */

export interface Content {
    text: string;
    url: string;
    sha256: string;

    // ISO 639-1 code (e.g. "en", "fr") of the source paragraph's language -
    // see TeiElemDto.language server-side. Undefined for content whose
    // language wasn't detected/carried through (treated conservatively,
    // i.e. NOT assumed embeddable - see VectorizerService).
    language?: string;

    embedding?: number[]
}

// export interface ContentProvider {
//     iterator(): AsyncGenerator<Content>;
// }

export interface ContentEmbedder {

    /**
     * @returns the content param, enriched with the embedding field.
     */
    embeddings(content: Content[]): Promise<Content[]>

    /**
     * ISO 639-1 codes this encoder produces meaningful embeddings for, or
     * 'all' for a genuinely multilingual model - see each implementation's
     * own comment for the basis of its claim. VectorizerService uses this
     * to skip content whose language isn't supported rather than silently
     * embedding it anyway with a model that was never trained on it.
     */
    readonly supportedLanguages: string[] | 'all';
}

export const PROVIDER_EMBEDDER = Symbol('ContentEmbedder');

type VectorizerEvent = 'event1' | 'event2'; 
export interface EventReporter {
    reportEvent(event: VectorizerEvent);
}

