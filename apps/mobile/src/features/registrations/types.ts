export type Registration = {
  id: string;
  type: "registration";
  name?: string;

  // Linking
  eventId?: string;

  // Optional associations (you noted: clientId == accountId)
  clientId?: string;      // aka accountId
  accountId?: string;

  // Other optional fields you may bring back later
  status?: string;
  notes?: string;

  createdAt?: string;
  updatedAt?: string;
};

// List options
export type RegistrationListOpts = {
  limit?: number;
  next?: string;
  order?: "asc" | "desc";
  eventId?: string; // key piece for filtering by event
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