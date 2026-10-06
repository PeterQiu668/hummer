const TENANT_CACHE_PREFIX = 'hummer.tenant.';
const LEGACY_EXACT_KEYS = new Set([
  'hummer-v6',
  'hummer-v6-unbound',
  'hummer-marketplace-hires',
]);
const LEGACY_PREFIXES = ['hummer-avatar-'];

export function tenantCacheKey(tenantId: string, cacheName: string): string {
  if (!tenantId.trim()) throw new Error('Renderer cache requires an authenticated tenant');
  if (!cacheName.trim()) throw new Error('Renderer cache name is invalid');
  return `${TENANT_CACHE_PREFIX}${encodeURIComponent(tenantId)}.${encodeURIComponent(cacheName)}`;
}

export function clearTenantRendererCache(tenantId: string): void {
  if (typeof localStorage === 'undefined') return;
  const prefix = `${TENANT_CACHE_PREFIX}${encodeURIComponent(tenantId)}.`;
  matchingKeys((key) => key.startsWith(prefix)).forEach((key) => localStorage.removeItem(key));
}

export function clearLegacyUnscopedRendererCaches(): void {
  if (typeof localStorage === 'undefined') return;
  matchingKeys((key) => LEGACY_EXACT_KEYS.has(key) || LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix)))
    .forEach((key) => localStorage.removeItem(key));
}

function matchingKeys(predicate: (key: string) => boolean): string[] {
  const matches: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && predicate(key)) matches.push(key);
  }
  return matches;
}
