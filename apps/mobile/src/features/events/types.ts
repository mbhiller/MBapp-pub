export type Event = {
  id: string;
  type: "event";
  name?: string;
  startDate?: string; // ISO
  endDate?: string;   // ISO
  location?: string;
  createdAt?: string;
  updatedAt?: string;
};
/*
export type Event = {
  id: string;
  type: "event";
  name: string;
  startsAt?: string;
  endsAt?: string;
  status?: string;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
};
*/

