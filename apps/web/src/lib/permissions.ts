/**
 * Permission helper with wildcard and fallback semantics.
 * Supports: exact match, {type}:*, *:{action}, *:*, and * (superuser).
 */

export type Policy = Record<string, boolean>;

/**
 * Check if a permission is granted by the policy.
 * Fails closed: null/undefined policy returns false.
 * Wildcard resolution order:
 *   1. Superuser (*)
 *   2. Exact match (e.g., "party:read")
 *   3. Type wildcard (e.g., "party:*")
 *   4. Action wildcard (e.g., "*:read")
 *   5. All wildcard (*:*)
 */
export function hasPerm(policy: Policy | null | undefined, perm: string): boolean {
  if (!policy || typeof policy !== "object") {
    return false; // Fail closed
  }

  // 1. Superuser (*)
  if (policy["*"] === true) {
    return true;
  }

  // 2. Exact match
  if (policy[perm] === true) {
    return true;
  }

  const parts = perm.split(":");
  if (parts.length !== 2) {
    // Invalid perm format; fail closed
    return false;
  }

  const [type, action] = parts;

  // 3. Type wildcard (e.g., "party:*")
  if (policy[`${type}:*`] === true) {
    return true;
  }

  // 4. Action wildcard (e.g., "*:read")
  if (policy[`*:${action}`] === true) {
    return true;
  }

  // 5. All wildcard (*:*)
  if (policy["*:*"] === true) {
    return true;
  }

  return false;
}

/**
 * Normalize required permission inputs (string or string[]) to a flat array of perms.
 * Splits whitespace-delimited perms (e.g., "event:read registration:read").
 */
export function normalizeRequired(required: string | string[]): string[] {
  const arr = Array.isArray(required) ? required : [required];
  const tokens: string[] = [];
  for (const item of arr) {
    if (!item) continue;
    for (const part of item.split(/\s+/)) {
      const p = part.trim();
      if (p) tokens.push(p);
    }
  }
  return tokens;
}
