// apps/mobile/src/features/registrations/actions.ts
import { apiClient } from "../../api/client";
import type { components } from "../../api/generated-types";
type Schemas = components["schemas"];

export async function cancelRegistration(id: string): Promise<Schemas["Registration"]> {
  return apiClient.post<Schemas["Registration"]>(
    `/events/registration/${encodeURIComponent(id)}:cancel`,
    {}
  );
}

export async function checkinRegistration(id: string): Promise<Schemas["Registration"]> {
  return apiClient.post<Schemas["Registration"]>(
    `/events/registration/${encodeURIComponent(id)}:checkin`,
    {}
  );
}

export async function checkoutRegistration(id: string): Promise<Schemas["Registration"]> {
  return apiClient.post<Schemas["Registration"]>(
    `/events/registration/${encodeURIComponent(id)}:checkout`,
    {}
  );
}
