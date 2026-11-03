/** Backend routes that must carry BIBLIOTECA_INTERNAL_API_TOKEN. */
export function requiresInternalApiToken(method: string, path: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  return /^\/api\/rag\/(search|ask|ask\/stream|chat)$/.test(path)
    || /^\/api\/vectorizing\/(start|pause|resume)$/.test(path)
    || /^\/api\/enrichment\/(run|run\/dry-run)$/.test(path)
    || /^\/api\/enrichment\/jobs\/[^/]+\/cancel$/.test(path)
    || /^\/api\/covers\/(run|run\/dry-run|work)$/.test(path)
    || /^\/api\/covers\/jobs\/[^/]+\/cancel$/.test(path)
    || path === '/api/vector-store/remove-opus'
    || path === '/api/vector-store/reset'
    || path === '/optimize';
}
