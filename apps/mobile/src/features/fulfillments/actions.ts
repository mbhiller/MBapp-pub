// apps/mobile/src/features/fulfillments/actions.ts
// Action helpers for Sales Fulfillments (mirror of sales order RPC style)

import { apiClient } from "../../api/client";

// Same LineDelta shape used across SO actions in your guide
export type FulfillLine = {
  lineId: string;
  deltaQty: number;
  lot?: string;
  locationId?: string;
};

/**
 * Post a fulfillment against a Sales Order.
 * Pass an idempotency key so repeat taps are safe.
 */
export async function postFulfillment(
  salesOrderId: string,
  args: { idempotencyKey: string; lines: FulfillLine[] }
) {
  const { idempotencyKey, lines } = args;
  // apiClient.post supports optional idempotency (third arg)
  // and matches your other action helpers.
  return apiClient.post(
    `/sales/so/${salesOrderId}:fulfill`,
    { lines },
    { idempotencyKey }
  );
}
