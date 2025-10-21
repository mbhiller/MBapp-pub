// Uses your canonical client.ts
import { apiClient } from "../../api/client";

export type Party = { id: string; kind: "person" | "org"; name: string; roles?: string[] };

export async function createParty(input: { kind: "person" | "org"; name: string }): Promise<Party> {
  return apiClient.post<Party>("/parties", input);
}

export async function addPartyRole(partyId: string, role: string): Promise<Party> {
  return apiClient.post<Party>(`/parties/${partyId}/roles`, { role });
}

// Optional, only if you wire a GET /parties/:id route:
export async function getParty(id: string): Promise<Party> {
  return apiClient.get<Party>(`/parties/${id}`);
}

export async function findParties(params: { role?: string; q?: string }): Promise<Party[]> {
  const qs = new URLSearchParams();
  if (params.role) qs.set("role", params.role);
  if (params.q) qs.set("q", params.q);
  const res = await apiClient.get<{ rows: Party[] }>(`/parties?${qs.toString()}`);
  return res?.rows ?? [];
}
