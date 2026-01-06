/**
 * Shared line identity resolution: determine the canonical key for a line.
 *
 * INVARIANTS:
 * - Prefer stable server-assigned id (non-empty, not tmp-*)
 * - Fallback to client-assigned cid (tmp-* prefix)
 * - Return null if neither exists (for callers to handle)
 *
 * This centralizes the key-resolution logic used by:
 * - patchLines: matching lines for update/remove
 * - ensureLineIds: collecting existing ids to avoid collision
 * - backorder reference resolution: finding lines by stable key
 */

export type LineLike = { id?: string; cid?: string } & Record<string, unknown>;

/**
 * Get the stable key for a line: prefer id (unless tmp-*), fallback to cid, else null.
 *
 * @param line Line object with optional id/cid
 * @returns Stable key (server id, client id, or null if neither exists)
 */
export function lineKey(line: LineLike | null | undefined): string | null {
  if (!line || typeof line !== "object") return null;

  const id = line.id ? String(line.id).trim() : "";
  const cid = line.cid ? String(line.cid).trim() : "";

  // Prefer server id (unless it's a client-only tmp-*)
  if (id && !id.startsWith("tmp-")) {
    return id;
  }

  // Use cid (tmp-* or already trimmed)
  if (cid) {
    return cid;
  }

  // Fall back to tmp-* id if it exists
  if (id && id.startsWith("tmp-")) {
    return id;
  }

  // No stable key found
  return null;
}

/**
 * Check if a string is a client-only temporary id (tmp-* prefix).
 * Used to distinguish client-generated ids from server-assigned stable ids.
 */
export function isClientOnlyId(id: string | undefined | null): boolean {
  if (!id) return false;
  const trimmed = String(id).trim();
  return trimmed.startsWith("tmp-");
}

/**
 * Trim and validate a potential id/cid value.
 * Returns undefined if empty after trim.
 */
export function trimId(id: unknown): string | undefined {
  if (typeof id === "string") {
    const trimmed = id.trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
}
