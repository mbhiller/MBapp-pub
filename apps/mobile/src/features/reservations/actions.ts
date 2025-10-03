// apps/mobile/src/features/reservations/actions.ts
import { apiClient } from "../../api/client";
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];

export async function cancelReservation(id: string): Promise<Schemas["Reservation"]> {
  return apiClient.post<Schemas["Reservation"]>(
    `/resources/reservation/${encodeURIComponent(id)}:cancel`,
    {}
  );
}

export async function startReservation(id: string): Promise<Schemas["Reservation"]> {
  return apiClient.post<Schemas["Reservation"]>(
    `/resources/reservation/${encodeURIComponent(id)}:start`,
    {}
  );
}

export async function endReservation(id: string): Promise<Schemas["Reservation"]> {
  return apiClient.post<Schemas["Reservation"]>(
    `/resources/reservation/${encodeURIComponent(id)}:end`,
    {}
  );
}
