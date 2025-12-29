// apps/api/src/sales/so-patch-lines.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects, type OrderStatus } from "../common/ddb";
import { resolveTenantId } from "../common/tenant";
import { badRequest, conflictError, internalError, notFound } from "../common/responses";
import { logger } from "../common/logger";
import { applyPatchLines, type PatchLineOp } from "../shared/patchLines";
import { ensureLineIds } from "../shared/ensureLineIds";

// Types aligned with existing sales order handlers
type SOLine = {
  id?: string;
  itemId?: string;
  uom?: string;
  qty?: number;
  [k: string]: any;
};

type SalesOrder = {
  pk: string; // tenant id
  sk: string; // salesOrder#<id>
  id: string;
  type: "salesOrder";
  status: OrderStatus;
  lines?: SOLine[];
  [k: string]: any;
};

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "OPTIONS,GET,POST,PUT,DELETE",
    "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Tenant-Id,Accept",
  },
  body: JSON.stringify(body),
});

function reqIdOf(event: APIGatewayProxyEventV2) { return (event.requestContext as any)?.requestId; }

async function loadSO(tenantId: string, id: string): Promise<SalesOrder | null> {
  const res = await ddb.send(new GetCommand({ TableName: tableObjects, Key: { pk: tenantId, sk: `salesOrder#${id}` } }));
  return (res.Item as SalesOrder) ?? null;
}

async function saveSO(order: SalesOrder): Promise<void> {
  const now = new Date().toISOString();
  const out: SalesOrder = { ...order, updatedAt: now };
  await ddb.send(new PutCommand({ TableName: tableObjects, Item: out }));
}

function parseOps(event: APIGatewayProxyEventV2): PatchLineOp[] | null {
  try {
    const body = JSON.parse(event.body || "{}");
    const ops = Array.isArray(body?.ops) ? body.ops : null;
    return ops ?? null;
  } catch {
    return null;
  }
}

function allowedToPatch(status: OrderStatus): boolean {
  // Allow editing lines up to approval; disallow once committed/fulfilled/cancelled/closed.
  return status === "draft" || status === "submitted" || status === "approved";
}

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = reqIdOf(event);
  const baseCtx = { requestId };
  try {
    const tenantId = resolveTenantId(event);
    const id = event.pathParameters?.id;
    if (!tenantId || !id) return badRequest("Missing tenant or id", undefined, requestId);
    const logCtx = { ...baseCtx, tenantId, route: event.rawPath ?? (event.requestContext as any)?.http?.path, method: (event.requestContext as any)?.http?.method };

    const ops = parseOps(event);
    if (!ops) {
      logger.warn(logCtx, "so-patch-lines.bad-body", { reason: "missing_ops" });
      return badRequest("Body must include ops[]", undefined, requestId);
    }

    const so = await loadSO(tenantId, id);
    if (!so) return notFound("Sales order not found", requestId);

    if (!allowedToPatch(so.status)) {
      logger.warn(logCtx, "so-patch-lines.guard", { status: so.status });
      return conflictError("SO not editable in current status", { code: "SO_NOT_EDITABLE", status: so.status }, requestId);
    }

    const beforeLines: SOLine[] = Array.isArray(so.lines) ? (so.lines as SOLine[]) : [];
    const beforeIds = new Set<string>(beforeLines.map(l => String(l.id || "").trim()).filter(Boolean));

    const { lines: patchedLines, summary } = applyPatchLines<SOLine>(beforeLines, ops);

    // Reserve removed ids so they are not reused by ensureLineIds
    const afterIds = new Set<string>(patchedLines.map(l => String(l.id || "").trim()).filter(Boolean));
    const removedIds: string[] = Array.from(beforeIds).filter(id => !afterIds.has(id));

    // Determine next counter start based on existing L{n} ids
    let maxNum = 0;
    for (const idStr of Array.from(beforeIds)) {
      const m = idStr.match(/^L(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n)) maxNum = Math.max(maxNum, n);
      }
    }

    const withIds = ensureLineIds<SOLine>(patchedLines, { reserveIds: removedIds, startAt: maxNum + 1 }) as SOLine[];

    so.lines = withIds;
    await saveSO(so);

    logger.info(logCtx, "so-patch-lines.saved", { soId: so.id, added: summary.added, updated: summary.updated, removed: summary.removed, lineCount: (so.lines || []).length });

    return json(200, so);
  } catch (err: any) {
    logger.error({ requestId: reqIdOf(event) }, "so-patch-lines.error", { message: err?.message });
    return internalError(err, requestId);
  }
}
