// apps/mobile/src/lib/permissions.ts

/**
 * Permission policy type (matches web and API)
 */
export type Policy = Record<string, boolean>;

/**
 * Check if a permission is granted by the policy.
 * Fails closed: null/undefined policy returns false.
 * 
 * Wildcard resolution order:
 *   1. Exact match (e.g., "party:read")
 *   2. Type wildcard (e.g., "party:*")
 *   3. Action wildcard (e.g., "*:read")
 *   4. All wildcard (*:*)
 *   5. Superuser (*)
 * 
 * Examples:
 *   hasPerm(policy, "objects:write")
 *   hasPerm(policy, "purchase:approve")
 */
export function hasPerm(policy: Policy | null | undefined, perm: string): boolean {
  if (!policy || typeof policy !== "object") {
    return false; // Fail closed
  }

  // 1. Exact match
  if (policy[perm] === true) {
    return true;
  }

  const parts = perm.split(":");
  if (parts.length !== 2) {
    // Invalid perm format; fail closed
    return false;
  }

  const [type, action] = parts;

  // 2. Type wildcard (e.g., "party:*")
  if (policy[`${type}:*`] === true) {
    return true;
  }

  // 3. Action wildcard (e.g., "*:read")
  if (policy[`*:${action}`] === true) {
    return true;
  }

  // 4. All wildcard (*:*)
  if (policy["*:*"] === true) {
    return true;
  }

  // 5. Superuser (*)
  if (policy["*"] === true) {
    return true;
  }

  return false;
}
