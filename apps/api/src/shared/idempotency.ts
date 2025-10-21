
// Basic in-memory idempotency; replace with DynamoDB table keyed by (tenant, actionKey)
const seen = new Set<string>();

export function idemKey(tenant: string, action: string, key?: string) {
  // key can be per-request header/body; fallback to a composed surrogate in dev
  return `${tenant}#${action}#${key ?? ''}`;
}
export function checkAndSetIdempotent(k: string): boolean {
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
}
