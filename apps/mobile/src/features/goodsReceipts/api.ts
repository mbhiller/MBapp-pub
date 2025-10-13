import { getObject, createObject, updateObject, apiClient } from "../../api/client";

/** Server doc: a posted goods receipt (immutable record of deltas) */
export type GoodsReceiptLine = {
  lineId: string;          // PurchaseOrderLine.id
  deltaQty: number;        // positive
  locationId?: string | null;
  lot?: string | null;
};

export type GoodsReceipt = {
  id: string;
  type?: "goodsReceipt";
  tenantId?: string;
  poId: string;
  userId?: string | null;
  ts: string;              // ISO date-time
  lines: GoodsReceiptLine[];
  notes?: string | null;
  attachments?: string[];
};

/** Create/Update bodies follow the same action shape */
export type GoodsReceiptLineInput = {
  lineId: string;          // PurchaseOrderLine.id
  deltaQty: number;
  locationId?: string | null;
  lot?: string | null;
};

export type CreateGoodsReceiptBody = {
  type?: "goodsReceipt";
  poId: string;
  ts?: string;             // server can default to now
  lines: GoodsReceiptLineInput[];
  notes?: string | null;
  attachments?: string[];
};

/** If you support editing before post, keep the same input for update */
export type UpdateGoodsReceiptBody = Partial<CreateGoodsReceiptBody> & {
  lines?: GoodsReceiptLineInput[];
};

export async function getGR(id: string) {
  return getObject<GoodsReceipt>("goodsReceipt", id);
}
export async function createGR(body: CreateGoodsReceiptBody) {
  return createObject<GoodsReceipt>("goodsReceipt", { type: "goodsReceipt", ...body } as any);
}
export async function updateGR(id: string, body: UpdateGoodsReceiptBody) {
  return updateObject<GoodsReceipt>("goodsReceipt", id, body as any);
}

/** Post (if you keep a /post action); otherwise create/put above is enough */
export async function postGR(id: string) {
  return apiClient.post<GoodsReceipt>(`/goodsReceipts/${id}/post`, {});
}
