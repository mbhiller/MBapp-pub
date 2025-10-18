export type LocationNode = {
  id: string; name: string;
  kind: "facility" | "hub" | "address" | "geo";
  coords?: { lat?: number; lng?: number };
  attributes?: Record<string, any>;
  active?: boolean;
};

export type PathEdge = {
  id: string; fromNodeId: string; toNodeId: string;
  distanceKm: number; durationMin?: number; cost?: number;
  isClosed?: boolean; attributes?: Record<string, any>;
};

export type DeliveryTask = {
  id: string; orderRef?: string; partyId: string;
  fromNodeId: string; toNodeId: string;
  window?: { start?: string; end?: string };
  status?: "draft"|"planned"|"enroute"|"delivered"|"failed"|"cancelled";
  attributes?: Record<string, any>;
};

export type RoutePlan = {
  id: string;
  objective: "shortest"|"fastest"|"cheapest"|"balanced";
  constraints?: { closures?: string[]; forbiddenNodes?: string[]; maxHoursPerDriver?: number; };
  carrierId?: string;
  tasks: { id: string }[];
  summary?: { distanceKm?: number; totalDurationMin?: number; totalCost?: number };
  status?: "draft"|"planned"|"executed"|"archived";
};

export type RoutingGraph = { nodes: LocationNode[]; edges: PathEdge[] };
