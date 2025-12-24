// apps/api/src/purchasing/po-create-from-suggestion.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { resolveTenantId } from "../common/tenant";

const PK = process.env.MBAPP_TABLE_PK || "pk";
const SK = process.env.MBAPP_TABLE_SK || "sk";

const json = (s: number, b: unknown): APIGatewayProxyResultV2 => ({
  statusCode: s,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(b),
});

// Deterministic hash for idempotent ids when Idempotency-Key is provided
function hashStr(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return (h >>> 0).toString(36);
}
function newPoId(seed?: string, i = 0) {
  const base = seed ? hashStr(seed + "#" + i) : Math.random().toString(36).slice(2, 10);
  return `po_${base}`;
}

type PurchaseOrderLine = { id?: string; lineId?: string; itemId: string; qty: number; receivedQty?: number; [k: string]: any };
type PurchaseOrderDraft = {
  id?: string;              // ephemeral ok; a persisted id is created
  vendorId: string;         // Party with vendor role
  status?: string;
  lines?: PurchaseOrderLine[];
  [k: string]: any;
};

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  if (event.requestContext?.http?.method !== "POST") return json(405, { message: "Method Not Allowed" });

  let tenantId: string;
  try {
    tenantId = resolveTenantId(event);
  } catch (err: any) {
    const status = err?.statusCode ?? 400;
    return json(status, { error: err?.code ?? "TenantError", message: err?.message ?? "Tenant resolution failed" });
  }

  let body: any = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { return json(400, { message: "Invalid JSON body" }); }

  const drafts: PurchaseOrderDraft[] =
    Array.isArray(body?.drafts) ? body.drafts :
    body?.draft ? [body.draft] :
    [];

  if (!drafts.length) return json(400, { message: "Provide `draft` or `drafts`" });

  const idemKey =
    (event.headers?.["Idempotency-Key"] as string) ||
    (event.headers?.["idempotency-key"] as string) ||
    null;

  const now = new Date().toISOString();
  const ids: string[] = [];

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    if (!draft?.vendorId) return json(400, { message: "vendorId is required on each draft" });

    const id = newPoId(idemKey ? `${tenantId}#po-create-from-suggestion#${idemKey}` : undefined, i);

    const lines = (draft.lines ?? []).map((ln: any, idx: number) => {
      const lid = String(ln?.id ?? ln?.lineId ?? `ln_${idx.toString(36)}${Date.now().toString(36).slice(-4)}`);
      return { ...ln, id: lid };
    });

    const po = {
      ...draft,
      id,
      type: "purchaseOrder",
      status: "draft",
      lines,
      createdAt: draft.createdAt ?? now,
      updatedAt: now,
    };

    await ddb.send(
      new PutCommand({
        TableName: tableObjects,
        Item: { [PK]: tenantId, [SK]: `purchaseOrder#${id}`, ...po },
      })
    );

    ids.push(id);
  }

  return json(200, { ids, id: ids.length === 1 ? ids[0] : undefined });
}

export default { handle };
