/** Turn errors from fetch/openapi-fetch into useful, bounded log text. */
export async function describeKafkaError(error: unknown): Promise<string> {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  const candidate = error as {
    status?: unknown;
    statusText?: unknown;
    url?: unknown;
    text?: () => Promise<string>;
    message?: unknown;
  } | null;
  if (candidate && typeof candidate === 'object' && ('status' in candidate || typeof candidate.text === 'function')) {
    let body = '';
    if (typeof candidate.text === 'function') {
      try {
        body = (await candidate.text()).trim();
      } catch {
        body = '<response body unavailable>';
      }
    }
    const status = candidate.status !== undefined ? `HTTP ${String(candidate.status)}` : 'HTTP error';
    const statusText = candidate.statusText ? ` ${String(candidate.statusText)}` : '';
    const url = candidate.url ? ` ${String(candidate.url)}` : '';
    const detail = body ? `: ${body.slice(0, 1000)}` : '';
    return `${status}${statusText}${url}${detail}`;
  }

  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) || String(error);
  } catch {
    return String(error);
  }
}
