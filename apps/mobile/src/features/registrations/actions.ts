// apps/mobile/src/features/registrations/actions.ts
import { apiClient } from "../../api/client";

const newIdempotencyKey = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const idem = () => ({ "Idempotency-Key": newIdempotencyKey() });

// Endpoints aligned to earlier smoke flows: /events/registration/{id}:*
export function registerRegistration(id: string) {
  return apiClient.post(`/events/registration/${encodeURIComponent(id)}:register`, {}, idem());
}
export function cancelRegistration(id: string) {
  return apiClient.post(`/events/registration/${encodeURIComponent(id)}:cancel`, {}, idem());
}
export function checkinRegistration(id: string) {
  return apiClient.post(`/events/registration/${encodeURIComponent(id)}:checkin`, {}, idem());
}
