// apps/api/src/shared/db.ts  (REPLACE)
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import type { OrderStatus } from "../common/ddb";

const PK = process.env.MBAPP_TABLE_PK || "pk";
const SK = process.env.MBAPP_TABLE_SK || "sk";

/** ===== Types ===== */
export type OrderLine = {
  id: string;
  itemId: string;            // <-- aligns with your SalesOrderLine
  productId?: string | null; // optional per your schema
  qty: number;
  qtyReserved?: number;
  qtyCommitted?: number;
  qtyFulfilled?: number;
  qtyReceived?: number;
  uom?: string;
  unitPrice?: number | null;
};

export type SalesOrder = {
  id: string;
  type: "salesOrder";
  status: OrderStatus;
  orderNumber?: string;
  date?: string;
  customerId?: string;
  lines: OrderLine[];
  pk?: string; sk?: string; tenantId?: string;
};

export type PurchaseOrder = {
  id: string;
  type: "purchaseOrder";
  status: OrderStatus;
  orderNumber?: string;
  date?: string;
  vendorId?: string;
  lines: OrderLine[];
  pk?: string; sk?: string; tenantId?: string;
};

/** ===== Keys ===== */
function soKey(tenantId: string, id: string) { return { [PK]: tenantId, [SK]: `salesOrder#${id}` }; }
function poKey(tenantId: string, id: string) { return { [PK]: tenantId, [SK]: `purchaseOrder#${id}` }; }
function invKey(tenantId: string, itemId: string) { return { [PK]: tenantId, [SK]: `inv#${itemId}` }; }
function num(n: any, d = 0) { return typeof n === "number" && Number.isFinite(n) ? n : d; }

/** ===== Orders ===== */
export async function getSalesOrder(tenantId: string, id: string): Promise<SalesOrder> {
  const res = await ddb.send(new GetCommand({ TableName: tableObjects, Key: soKey(tenantId, id) }));
  if (!res.Item) throw Object.assign(new Error("Sales order not found"), { statusCode: 404, ctx: { id } });
  return res.Item as SalesOrder;
}
export async function updateSalesOrder(id: string, tenantId: string, patch: Partial<SalesOrder>): Promise<SalesOrder> {
  if (!patch || Object.keys(patch).length === 0) return await getSalesOrder(tenantId, id);
  const names: Record<string, string> = {}, values: Record<string, any> = {}; const sets: string[] = [];
  let i = 0; for (const [k, v] of Object.entries(patch)) { const nk=`#k${i}`, nv=`:v${i}`; names[nk]=k; values[nv]=v; sets.push(`${nk}=${nv}`); i++; }
  const res = await ddb.send(new UpdateCommand({ TableName: tableObjects, Key: soKey(tenantId, id),
    UpdateExpression: `SET ${sets.join(",")}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: "ALL_NEW" }));
  return res.Attributes as SalesOrder;
}

export async function getPurchaseOrder(tenantId: string, id: string): Promise<PurchaseOrder> {
  const res = await ddb.send(new GetCommand({ TableName: tableObjects, Key: poKey(tenantId, id) }));
  if (!res.Item) throw Object.assign(new Error("Purchase order not found"), { statusCode: 404, ctx: { id } });
  return res.Item as PurchaseOrder;
}
export async function updatePurchaseOrder(id: string, tenantId: string, patch: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
  if (!patch || Object.keys(patch).length === 0) return await getPurchaseOrder(tenantId, id);
  const names: Record<string, string> = {}, values: Record<string, any> = {}; const sets: string[] = [];
  let i = 0; for (const [k, v] of Object.entries(patch)) { const nk=`#k${i}`, nv=`:v${i}`; names[nk]=k; values[nv]=v; sets.push(`${nk}=${nv}`); i++; }
  const res = await ddb.send(new UpdateCommand({ TableName: tableObjects, Key: poKey(tenantId, id),
    UpdateExpression: `SET ${sets.join(",")}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: "ALL_NEW" }));
  return res.Attributes as PurchaseOrder;
}

/** ===== Inventory (itemId-centric) ===== */
type InvCounter = { pk: string; sk: string; tenantId: string; type: "inventoryCounter"; itemId: string; onHand: number; reserved: number; };

async function ensureInv(tenantId: string, itemId: string): Promise<InvCounter> {
  const res = await ddb.send(new GetCommand({ TableName: tableObjects, Key: invKey(tenantId, itemId) }));
  if (res.Item) {
    const it = res.Item as InvCounter;
    (it as any).onHand = num((it as any).onHand, 0);
    (it as any).reserved = num((it as any).reserved, 0);
    return it;
  }
  const fresh: any = { ...invKey(tenantId, itemId), tenantId, type: "inventoryCounter", itemId, onHand: 0, reserved: 0 };
  await ddb.send(new PutCommand({ TableName: tableObjects, Item: fresh }));
  return fresh as InvCounter;
}

export async function getCounters(tenantId: string, itemId: string) {
  const it = await ensureInv(tenantId, itemId);
  const onHand = num((it as any).onHand, 0);
  const reserved = num((it as any).reserved, 0);
  return { onHand, reserved, available: onHand - reserved };
}
export async function reserveStock(tenantId: string, itemId: string, qty: number) {
  if (qty <= 0) return { ok: true };
  await ensureInv(tenantId, itemId);
  const res = await ddb.send(new UpdateCommand({
    TableName: tableObjects, Key: invKey(tenantId, itemId),
    UpdateExpression: "SET #r=if_not_exists(#r,:z)+:q",
    ConditionExpression: "(if_not_exists(#h,:z)-if_not_exists(#r,:z))>=:q",
    ExpressionAttributeNames: { "#r": "reserved", "#h": "onHand" },
    ExpressionAttributeValues: { ":q": qty, ":z": 0 },
    ReturnValues: "ALL_NEW",
  }));
  return { ok: true, after: res.Attributes };
}
export async function releaseStock(tenantId: string, itemId: string, qty: number) {
  if (qty <= 0) return { ok: true };
  await ensureInv(tenantId, itemId);
  const res = await ddb.send(new UpdateCommand({
    TableName: tableObjects, Key: invKey(tenantId, itemId),
    UpdateExpression: "SET #r=if_not_exists(#r,:z)-:q",
    ConditionExpression: "if_not_exists(#r,:z)>=:q",
    ExpressionAttributeNames: { "#r": "reserved" },
    ExpressionAttributeValues: { ":q": qty, ":z": 0 },
    ReturnValues: "ALL_NEW",
  }));
  return { ok: true, after: res.Attributes };
}
export async function consumeStock(tenantId: string, itemId: string, qty: number) {
  if (qty <= 0) return { ok: true };
  await ensureInv(tenantId, itemId);
  const res = await ddb.send(new UpdateCommand({
    TableName: tableObjects, Key: invKey(tenantId, itemId),
    UpdateExpression: "SET #h=if_not_exists(#h,:z)-:q",
    ConditionExpression: "if_not_exists(#h,:z)>=:q",
    ExpressionAttributeNames: { "#h": "onHand" },
    ExpressionAttributeValues: { ":q": qty, ":z": 0 },
    ReturnValues: "ALL_NEW",
  }));
  return { ok: true, after: res.Attributes };
}
export async function receiveStock(tenantId: string, itemId: string, qty: number) {
  if (qty <= 0) return { ok: true };
  await ensureInv(tenantId, itemId);
  const res = await ddb.send(new UpdateCommand({
    TableName: tableObjects, Key: invKey(tenantId, itemId),
    UpdateExpression: "SET #h=if_not_exists(#h,:z)+:q",
    ExpressionAttributeNames: { "#h": "onHand" },
    ExpressionAttributeValues: { ":q": qty, ":z": 0 },
    ReturnValues: "ALL_NEW",
  }));
  return { ok: true, after: res.Attributes };
}
