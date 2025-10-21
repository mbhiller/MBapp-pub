import { PathEdge } from "./types";
type WeightKey = "distanceKm" | "durationMin" | "cost";

export function shortestPath(
  start: string, target: string, edges: PathEdge[],
  opts?: { weight?: WeightKey; closed?: Set<string>; forbiddenNodes?: Set<string> }
): { path: string[]; weight: number } | null {
  const weightKey: WeightKey = opts?.weight ?? "distanceKm";
  const closed = opts?.closed ?? new Set<string>();
  const forbid = opts?.forbiddenNodes ?? new Set<string>();

  const adj = new Map<string, PathEdge[]>();
  for (const e of edges) {
    if (closed.has(e.id) || e.isClosed) continue;
    if (forbid.has(e.fromNodeId) || forbid.has(e.toNodeId)) continue;
    (adj.get(e.fromNodeId) ?? adj.set(e.fromNodeId, []).get(e.fromNodeId)!).push(e);
  }

  const dist = new Map<string, number>(); const prev = new Map<string, string>(); const Q = new Set<string>();
  const nodes = new Set<string>(); edges.forEach(e => { nodes.add(e.fromNodeId); nodes.add(e.toNodeId); }); nodes.add(start); nodes.add(target);
  for (const n of nodes) { dist.set(n, Infinity); Q.add(n); } dist.set(start, 0);

  while (Q.size) {
    let u: string | null = null, best = Infinity;
    for (const n of Q) { const w = dist.get(n)!; if (w < best) { best = w; u = n; } }
    if (u == null) break; Q.delete(u); if (u === target) break;
    for (const e of (adj.get(u) ?? [])) {
      const v = e.toNodeId; if (!Q.has(v)) continue;
      const alt = dist.get(u)! + (e[weightKey] ?? e.distanceKm ?? 0);
      if (alt < dist.get(v)!) { dist.set(v, alt); prev.set(v, u); }
    }
  }
  if (start !== target && !prev.has(target)) return null;

  const path: string[] = []; let cur: string | undefined = target; path.unshift(cur);
  while (prev.has(cur!)) { cur = prev.get(cur!)!; path.unshift(cur); }
  const weight = dist.get(target)!; if (!isFinite(weight)) return null;
  return { path, weight };
}
