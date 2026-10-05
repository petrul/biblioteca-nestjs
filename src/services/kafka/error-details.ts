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

/**
 * Kafka group-membership errors - the coordinator has evicted this
 * consumer from its group (UNKNOWN_MEMBER_ID / ILLEGAL_GENERATION, e.g.
 * after a session-timeout expiry mid-processing) or the group is
 * mid-rebalance / coordinatorless. In-place retry can NEVER succeed:
 * every heartbeat and offset commit is rejected until the consumer
 * rejoins the group, which only KafkaJS's own recovery can do.
 */
const MEMBERSHIP_ERROR_TYPES = new Set([
    'UNKNOWN_MEMBER_ID',
    'ILLEGAL_GENERATION',
    'REBALANCE_IN_PROGRESS',
    'NOT_COORDINATOR_FOR_GROUP',
    'COORDINATOR_NOT_AVAILABLE',
    'COORDINATOR_LOAD_IN_PROGRESS',
    'FENCED_INSTANCE_ID',
]);

export function isMembershipError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { type?: unknown; code?: unknown; message?: unknown };
    return MEMBERSHIP_ERROR_TYPES.has(String(candidate.type))
        || MEMBERSHIP_ERROR_TYPES.has(String(candidate.code))
        || /coordinator is not aware of this member|not the coordinator/i.test(String(candidate.message ?? ''));
}
