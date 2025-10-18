import { apiClient } from "../../api/client";
import type { components } from "../../api/generated-types";

export type RoutePlan = components["schemas"]["RoutePlan"];

export const routingApi = {
  upsertGraph: (graph: { nodes: any[]; edges: any[] }) =>
    apiClient.post<{ ok: boolean; nodes: number; edges: number }>("/routing/graph", graph),

  createPlan: (body: {
    objective: "shortest" | "fastest" | "cheapest" | "balanced";
    tasks: Array<{ id: string; fromNodeId: string; toNodeId: string }>;
    constraints?: { closures?: string[]; forbiddenNodes?: string[] };
    carrierId?: string;
  }) => apiClient.post<RoutePlan>("/routing/plan", body),

  getPlan: (id: string) => apiClient.get<RoutePlan>(`/routing/plan/${id}`),
};
