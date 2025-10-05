export function newIdempotencyKey(prefix = "mob"): string {
  // short, collision-resistant enough for mobile writes
  const r = Math.random().toString(36).slice(2);
  const t = Date.now().toString(36);
  return `${prefix}_${t}_${r}`;
}
