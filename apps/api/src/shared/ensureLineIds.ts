// apps/api/src/shared/ensureLineIds.ts
// Assign stable line ids where missing.
//
// Usage expectation:
// - Callers should run ensureLineIds() AFTER applying any line patch operations.
// - patchLines (apps/api/src/shared/patchLines.ts) does not assign ids; ensureLineIds
//   assigns stable `L{n}` IDs where missing, preserves existing ids, and avoids reuse.

import { lineKey } from "./lineKey";

export type LineLike = { id?: string; cid?: string } & Record<string, unknown>;

type EnsureOptions = {
  /** Reserve these ids so they are never reused (e.g., removed lines). */
  reserveIds?: string[];
  /** Start counter from this value (e.g., max existing + 1). */
  startAt?: number;
};

// Assign stable line ids where missing: existing ids remain, new ones get L{n}, skipping any reserved ids.
export function ensureLineIds<T extends LineLike>(lines: T[] | unknown, opts: EnsureOptions = {}): T[] | unknown {
  if (!Array.isArray(lines)) return lines;
  const used = new Set<string>();

  for (const id of opts.reserveIds ?? []) {
    if (typeof id === "string" && id.trim()) used.add(id.trim());
  }

  // Collect existing stable line keys to avoid collisions
  for (const line of lines) {
    const key = lineKey(line as LineLike);
    if (key) {
      used.add(key);
    }
  }

  let counter = Math.max(opts.startAt ?? 1, 1);
  const nextId = () => {
    let candidate = `L${counter}`;
    while (used.has(candidate)) {
      counter += 1;
      candidate = `L${counter}`;
    }
    used.add(candidate);
    counter += 1;
    return candidate;
  };

  return lines.map((line) => {
    if (!line || typeof line !== "object") return line;
    const key = lineKey(line as LineLike);
    // If line already has a stable key (server id or cid), keep it as-is
    if (key) return line;
    // No key: assign stable id
    return { ...(line as Record<string, unknown>), id: nextId() } as T;
  });
}
