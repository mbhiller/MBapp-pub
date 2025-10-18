import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";

type PathEdge = {
  id: string; fromNodeId: string; toNodeId: string;
  distanceKm: number; durationMin?: number; cost?: number; isClosed?: boolean;
};
type DeliveryTask = { id: string; fromNodeId: string; toNodeId: string };
type RoutePlan = {
  id: string;
  objective: "shortest" | "fastest" | "cheapest" | "balanced";
  constraints?: { closures?: string[]; forbiddenNodes?: string[] };
  carrierId?: string;
  tasks: { id: string }[];
  summary?: { distanceKm?: number; totalDurationMin?: number; totalCost?: number };
  status?: "draft" | "planned" | "executed" | "archived";
};

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  },
  body: JSON.stringify(body),
});

function shortestPath(
  start: string,
  target: string,
  edges: PathEdge[],
  opts?: { weight?: "distanceKm" | "durationMin" | "cost"; closed?: Set<string>; forbiddenNodes?: Set<string> }
): { path: string[]; weight: number } | null {
  const weightKey = opts?.weight ?? "distanceKm";
  const closed = opts?.closed ?? new Set<string>();
  const forbid = opts?.forbiddenNodes ?? new Set<string>();

  const adj = new Map<string, PathEdge[]>();
  for (const e of edges) {
    if (closed.has(e.id) || e.isClosed) continue;
    if (forbid.has(e.fromNodeId) || forbid.has(e.toNodeId)) continue;
    (adj.get(e.fromNodeId) ?? adj.set(e.fromNodeId, []).get(e.fromNodeId)!).push(e);
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const Q = new Set<string>();
  const nodes = new Set<string>(); edges.forEach(e => { nodes.add(e.fromNodeId); nodes.add(e.toNodeId); }); nodes.add(start); nodes.add(target);
  for (const n of nodes) { dist.set(n, Infinity); Q.add(n); } dist.set(start, 0);

  while (Q.size) {
    let u: string | null = null, best = Infinity;
    for (const n of Q) { const w = dist.get(n)!; if (w < best) { best = w; u = n; } }
    if (u == null) break; Q.delete(u); if (u === target) break;

    for (const e of (adj.get(u) ?? [])) {
      const v = e.toNodeId; if (!Q.has(v)) continue;
      const alt = (dist.get(u) ?? Infinity) + (e[weightKey] ?? e.distanceKm ?? 0);
      if (alt < (dist.get(v) ?? Infinity)) { dist.set(v, alt); prev.set(v, u); }
    }
  }
  if (start !== target && !prev.has(target)) return null;

  const path: string[] = [];
  let cur: string | undefined = target; path.unshift(cur);
  while (prev.has(cur!)) { cur = prev.get(cur!)!; path.unshift(cur); }
  const weight = dist.get(target)!; if (!isFinite(weight)) return null;
  return { path, weight };
}

export async function handle(event: any): Promise<APIGatewayProxyResultV2> {
  const body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body || {});
  const { objective = "shortest", constraints, carrierId } = body;
  const tasks: DeliveryTask[] = Array.isArray(body?.tasks) ? body.tasks : [];

  // MVP: accept graph inline (until persistence is finalized)
  const graph = body?.graph as { nodes?: any[]; edges?: PathEdge[] } | undefined;
  if (!graph?.edges?.length) {
    return json(409, { message: "Routing graph is empty. POST /routing/graph or include {graph} in the request." });
  }

  const closed = new Set<string>([...(constraints?.closures || [])]);
  const forbiddenNodes = new Set<string>([...(constraints?.forbiddenNodes || [])]);
  const weightKey: "distanceKm" | "durationMin" | "cost" =
    objective === "fastest" ? "durationMin" : objective === "cheapest" ? "cost" : "distanceKm";

  let distanceKm = 0, totalDurationMin = 0, totalCost = 0;

  for (const t of tasks) {
    const res = shortestPath(t.fromNodeId, t.toNodeId, graph.edges, { weight: weightKey, closed, forbiddenNodes });
    if (!res) return json(409, { message: `No feasible path for task ${t.id}` });
    if (weightKey === "distanceKm") distanceKm += res.weight;
    if (weightKey === "durationMin") totalDurationMin += res.weight;
    if (weightKey === "cost") totalCost += res.weight;
  }

  const plan: RoutePlan = {
    id: body?.id || randomUUID(),
    objective,
    constraints,
    carrierId,
    tasks: tasks.map(t => ({ id: t.id })),
    summary: {
      distanceKm: distanceKm || undefined,
      totalDurationMin: totalDurationMin || undefined,
      totalCost: totalCost || undefined,
    },
    status: "planned",
  };

  // MVP: return computed plan (no persistence yet)
  return json(200, plan);
}
