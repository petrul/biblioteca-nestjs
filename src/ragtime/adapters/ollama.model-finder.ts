/** The generating model used when Ollama has none loaded: fits the shared 12 GB GPU next to the pinned bge-m3. */
export const DEFAULT_GENERATION_MODEL = 'qwen3.5:9b';

export interface OllamaModelFinderOptions {
  url: string;
  /** Default qwen3.5:9b. */
  defaultModel?: string;
  /** How long a found model is reused before asking Ollama again. Default 60 s. */
  ttlMs?: number;
}

/**
 * Finds the generating model to use, lazily - on first use, not at
 * construction, so a service starts while Ollama is down: the generating
 * model Ollama already has loaded, whichever it is (on a shared GPU,
 * swapping models costs every client), else the default model.
 *
 * Only a model with the "completion" capability counts: a pinned embedding
 * model (bge-m3) answers chat calls with HTTP 400. Capabilities never change
 * for a model name, so they are remembered; unreadable ones are not reused.
 */
export class OllamaGenerativeModelFinder {
  private readonly url: string;
  private found: { model: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;
  private readonly generates = new Map<string, boolean>();

  constructor(private readonly options: OllamaModelFinderOptions) {
    this.url = options.url.replace(/\/+$/, '');
  }

  get defaultModel(): string {
    return this.options.defaultModel ?? DEFAULT_GENERATION_MODEL;
  }

  /** The model found last, or the default before the first find. */
  get current(): string {
    return this.found?.model ?? this.defaultModel;
  }

  /** The model to generate with now; concurrent callers share one lookup. */
  async find(): Promise<string> {
    if (this.found && this.found.expiresAt > Date.now()) return this.found.model;
    this.pending ??= this.lookup().finally(() => { this.pending = null; });
    return this.pending;
  }

  /** Forget the found model (it vanished, or cannot chat): the next find asks Ollama again. */
  invalidate(): void {
    this.found = null;
  }

  private async lookup(): Promise<string> {
    let model = this.defaultModel;
    try {
      const response = await fetch(`${this.url}/api/ps`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        const { models } = (await response.json()) as { models?: { name: string }[] };
        for (const loaded of models ?? []) {
          if (loaded?.name && (await this.canGenerate(loaded.name))) {
            model = loaded.name;
            break;
          }
        }
      }
    } catch {
      // Ollama unreachable for /api/ps: the generation call itself reports it
    }
    this.found = { model, expiresAt: Date.now() + (this.options.ttlMs ?? 60_000) };
    return model;
  }

  private async canGenerate(model: string): Promise<boolean> {
    const known = this.generates.get(model);
    if (known !== undefined) return known;
    try {
      const response = await fetch(`${this.url}/api/show`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;
      const { capabilities } = (await response.json()) as { capabilities?: string[] };
      const generates = Array.isArray(capabilities) && capabilities.includes('completion');
      this.generates.set(model, generates);
      return generates;
    } catch {
      return false;
    }
  }
}
