/**
 * Shared CID (client-assigned ID) generation for line editing.
 * CID is sent to API for new lines to enable idempotency tracking.
 * All CIDs use tmp-* prefix; never fabricate server ids (L{n} pattern).
 */

/**
 * Generate a stable client-only temporary ID (tmp-* prefix).
 * Uses crypto.randomUUID if available, else timestamp + random fallback.
 * Result is sent to API as `cid` for new lines (idempotency key).
 */
export function generateCid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function") {
      return `tmp-${(crypto as any).randomUUID()}`;
    }
  } catch {}
  // Fallback if randomUUID unavailable: timestamp + short random
  return `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Get or generate stable key for a line: prefer server id, else cid, else generate.
 * Never use fabricated ids (L{n} pattern).
 * This key is used for React rendering and idempotent updates.
 */
export function getOrGenerateLineKey(line: { id?: string; cid?: string }): string {
  const id = line.id ? String(line.id).trim() : "";
  const cid = line.cid ? String(line.cid).trim() : "";
  
  // Prefer server id (unless it looks like client-only tmp-*)
  if (id && !id.startsWith("tmp-")) {
    return id;
  }
  
  // Use cid if present
  if (cid) {
    return cid;
  }
  
  // Fall back to tmp-* server id if it exists
  if (id && id.startsWith("tmp-")) {
    return id;
  }
  
  // Generate new cid if nothing exists
  return generateCid();
}

/**
 * Ensure a line has a cid if it lacks a server id.
 * Does not mutate the input; returns new object if cid is added.
 */
export function ensureLineCid<T extends { id?: string; cid?: string }>(line: T): T {
  const id = line.id ? String(line.id).trim() : "";
  const hasServerId = id && !id.startsWith("tmp-");
  
  if (hasServerId) {
    // Has server id; cid is optional
    return line;
  }
  
  // No server id; ensure cid exists
  const cid = line.cid ? String(line.cid).trim() : "";
  if (cid) {
    return line;
  }
  
  // Generate and assign cid
  return {
    ...line,
    cid: generateCid(),
  };
}
