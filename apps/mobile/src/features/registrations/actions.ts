// apps/mobile/src/features/registrations/actions.ts
import { apiClient, getFeatureHeaders } from "../../api/client";
import type { components } from "../../api/generated-types";

const newIdempotencyKey = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const idem = () => ({ "Idempotency-Key": newIdempotencyKey() });

// Endpoints aligned to earlier smoke flows: /events/registration/{id}:*
export function registerRegistration(id: string) {
  return apiClient.post(`/events/registration/${encodeURIComponent(id)}:register`, {}, idem());
}
export function cancelRegistration(id: string) {
  return apiClient.post(`/events/registration/${encodeURIComponent(id)}:cancel`, {}, idem());
}
export function checkinRegistration(id: string, headers?: Record<string, string>) {
  const baseHeaders = { ...idem(), ...getFeatureHeaders() };
  const merged = headers ? { ...baseHeaders, ...headers } : baseHeaders;
  return apiClient.post(`/events/registration/${encodeURIComponent(id)}:checkin`, {}, merged);
}

export function resolveRegistrationScan(eventId: string, scanString: string, scanType: "auto" | "qr" | "barcode" | "epc" = "auto") {
  return apiClient.post<components["schemas"]["ScanResolutionResult"]>(
    `/registrations:resolve-scan`,
    { eventId, scanString, scanType },
    getFeatureHeaders()
  );
}
