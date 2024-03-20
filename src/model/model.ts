/**
 * these should be the basic subsystems
 */

export interface Content {
    text: string;
    url: string;
    sha256: string;
    
    embedding?: number[]
}

export interface ContentProvider {
    iterator(): AsyncGenerator<Content>;
}

export interface EmbeddingModel {
    embed(content: Content[]): Promise<Content>
}

export interface VectorStore {
    store(content: Content[])
}

type VectorizerEvent = 'event1' | 'event2'; 
export interface EventReporter {
    reportEvent(event: VectorizerEvent);
}

