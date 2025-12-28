export type LineLike = { id?: string } & Record<string, unknown>;

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

  // Collect existing ids from incoming lines to avoid collisions
  for (const line of lines) {
    const id = (line as LineLike)?.id;
    if (typeof id === "string" && id.trim()) {
      used.add(id.trim());
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
    const id = (line as LineLike).id;
    if (typeof id === "string" && id.trim()) return line;
    return { ...(line as Record<string, unknown>), id: nextId() } as T;
  });
}
