// apps/mobile/src/features/registrations/types.ts
export type Registration = {
  id: string;
  type: "registration";
  tenantId?: string;

  eventId?: string;
  clientId?: string; // aka accountId in some data; UI uses clientId

  // Optional UI-friendly fields
  name?: string;
  status?: string;
  notes?: string;

  createdAt?: string;
  updatedAt?: string;
};

export type Page<T> = { items: T[]; next?: string };
export type CountResponse = { count: number };
