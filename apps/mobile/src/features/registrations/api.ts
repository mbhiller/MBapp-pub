// apps/mobile/src/features/registrations/api.ts
import { apiClient } from "../../api/client";
import type { Registration, Page } from "./types";

export type RegistrationListParams = {
  q?: string;
  eventId?: string;
  partyId?: string;
  status?: "draft" | "submitted" | "confirmed" | "cancelled";
  limit?: number;
  next?: string;
};

export type CreateRegistrationInput = {
  eventId: string;
  partyId: string;
  division?: string;
  class?: string;
  status?: "draft" | "submitted" | "confirmed" | "cancelled";
  fees?: Array<{ code: string; amount: number; qty?: number }>;
  notes?: string;
};

function toQuery(params?: RegistrationListParams): Record<string, string> {
  if (!params) return {};
  const result: Record<string, string> = {};
  if (params.q !== undefined) result.q = params.q;
  if (params.eventId !== undefined) result.eventId = params.eventId;
  if (params.partyId !== undefined) result.partyId = params.partyId;
  if (params.status !== undefined) result.status = params.status;
  if (params.limit !== undefined) result.limit = String(params.limit);
  if (params.next !== undefined) result.next = params.next;
  return result;
}

export function listRegistrations(params?: RegistrationListParams): Promise<Page<Registration>> {
  return apiClient.get<Page<Registration>>("/registrations", toQuery(params));
}

export function createRegistration(input: CreateRegistrationInput): Promise<Registration> {
  return apiClient.post<Registration>("/registrations", input, {
    "X-Feature-Registrations-Enabled": "1"
  });
}

export function getRegistration(id: string): Promise<Registration> {
  return apiClient.get<Registration>(`/registrations/${encodeURIComponent(id)}`, {
    "X-Feature-Registrations-Enabled": "1"
  });
}
