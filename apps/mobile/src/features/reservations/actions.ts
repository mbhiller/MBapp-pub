// apps/mobile/src/features/reservations/actions.ts
import { apiClient } from "../../api/client";

const newIdempotencyKey = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const idem = () => ({ "Idempotency-Key": newIdempotencyKey() });

// REST shape: /reservations/{id}:action
export function holdReservation(id: string) {
  return apiClient.post(`/reservations/${encodeURIComponent(id)}:hold`, {}, idem());
}
export function confirmReservation(id: string) {
  return apiClient.post(`/reservations/${encodeURIComponent(id)}:confirm`, {}, idem());
}
export function releaseReservation(id: string) {
  return apiClient.post(`/reservations/${encodeURIComponent(id)}:release`, {}, idem());
}
export function reassignReservation(id: string, toResourceId: string) {
  return apiClient.post(`/reservations/${encodeURIComponent(id)}:reassign`, { toResourceId }, idem());
}
