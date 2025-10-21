import { getObject, createObject, updateObject, apiClient } from "../../api/client";

/** Server doc: a posted fulfillment (immutable record of deltas) */
export type SalesFulfillmentLine = {
  lineId: string;          // SalesOrderLine.id
  deltaQty: number;        // positive
  locationId?: string | null;
  lot?: string | null;
};

export type Fulfillment = {
  id: string;
  type?: "salesFulfillment";
  tenantId?: string;
  soId: string;
  userId?: string | null;
  ts: string;              // ISO date-time
  lines: SalesFulfillmentLine[];
  carrier?: string | null;
  tracking?: string | null;
  notes?: string | null;
  attachments?: string[];
};

/** Create/Update bodies follow the same shape: actions against SO lines */
export type FulfillmentLineInput = {
  lineId: string;          // SalesOrderLine.id
  deltaQty: number;
  locationId?: string | null;
  lot?: string | null;
};

export type CreateFulfillmentBody = {
  type?: "salesFulfillment";
  soId: string;
  ts?: string;             // server can default to now
  lines: FulfillmentLineInput[];
  carrier?: string | null;
  tracking?: string | null;
  notes?: string | null;
  attachments?: string[];
};

/** If you support editing before post, keep the same input for update */
export type UpdateFulfillmentBody = Partial<CreateFulfillmentBody> & {
  lines?: FulfillmentLineInput[];
};

export async function getFF(id: string) {
  return getObject<Fulfillment>("fulfillment", id);
}
export async function createFF(body: CreateFulfillmentBody) {
  return createObject<Fulfillment>("fulfillment", { type: "salesFulfillment", ...body } as any);
}
export async function updateFF(id: string, body: UpdateFulfillmentBody) {
  return updateObject<Fulfillment>("fulfillment", id, body as any);
}

/** Post (if you keep a /post action); otherwise create/put above is enough */
export async function postFF(id: string) {
  return apiClient.post<Fulfillment>(`/fulfillments/${id}/post`, {});
}
