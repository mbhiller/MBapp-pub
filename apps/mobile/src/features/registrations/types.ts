export type RegistrationStatus = "pending" | "confirmed" | "cancelled";
export type Registration = {
  id: string;
  type: "registration";
  eventId: string;
  clientId?: string;
  qty?: number;
  status?: RegistrationStatus;
  createdAt?: string;
  updatedAt?: string;
};
/*export type Registration = {
  id: string;
  type: "registration";
  eventId: string;
  accountId?: string;
  status?: "pending" | "confirmed" | "canceled";
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
};*/