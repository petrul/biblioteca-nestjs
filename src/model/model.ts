/**
 * these should be the basic subsystems
 */

export interface Content {
    text: string;
    url: string;
    sha256: string;
    
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
}

export const PROVIDER_EMBEDDER = Symbol('ContentEmbedder');

type VectorizerEvent = 'event1' | 'event2'; 
export interface EventReporter {
    reportEvent(event: VectorizerEvent);
}

