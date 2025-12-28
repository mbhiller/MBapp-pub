// apps/api/src/purchasing/po-patch-lines.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { resolveTenantId } from "../common/tenant";
import { badRequest, conflictError, internalError, notFound } from "../common/responses";
import { logger } from "../common/logger";
import { getPurchaseOrder, updatePurchaseOrder, type PurchaseOrder } from "../shared/db";
import { applyPatchLines, type PatchLineOp } from "../shared/patchLines";
import { ensureLineIds } from "../shared/ensureLineIds";

// Lightweight types for PO lines
type POLine = { id?: string; itemId?: string; qty?: number; uom?: string; [k: string]: any };

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

function parseOps(event: APIGatewayProxyEventV2): PatchLineOp[] | null {
  try {
    const body = JSON.parse(event.body || "{}");
    return Array.isArray(body?.ops) ? body.ops : null;
  } catch {
    return null;
  }
}

function isEditable(status: string): boolean {
  // Strict default: only allow editing in 'draft'. Adjust if needed.
  const s = String(status || "").toLowerCase();
  return s === "draft";
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
      logger.warn(logCtx, "po-patch-lines.bad-body", { reason: "missing_ops" });
      return badRequest("Body must include ops[]", undefined, requestId);
    }

    let po: PurchaseOrder;
    try {
      po = await getPurchaseOrder(tenantId, id);
    } catch (err: any) {
      if ((err?.statusCode ?? 0) === 404) return notFound("Purchase order not found", requestId);
      return internalError(err, requestId);
    }

    if (!isEditable(po.status as any)) {
      logger.warn(logCtx, "po-patch-lines.guard", { status: po.status });
      return conflictError("PO not editable in current status", { code: "PO_NOT_EDITABLE", status: po.status }, requestId);
    }

    const beforeLines: POLine[] = Array.isArray(po.lines) ? (po.lines as POLine[]) : [];
    const beforeIds = new Set<string>(beforeLines.map(l => String(l.id || "").trim()).filter(Boolean));

    const { lines: patchedLines, summary } = applyPatchLines<POLine>(beforeLines, ops);

    // Reserve removed ids so ensureLineIds does not reuse them
    const afterIds = new Set<string>(patchedLines.map(l => String(l.id || "").trim()).filter(Boolean));
    const removedIds: string[] = Array.from(beforeIds).filter(id => !afterIds.has(id));

    // Determine next L{n} counter start from existing ids
    let maxNum = 0;
    for (const idStr of Array.from(beforeIds)) {
      const m = idStr.match(/^L(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n)) maxNum = Math.max(maxNum, n);
      }
    }

    const withIds = ensureLineIds<POLine>(patchedLines, { reserveIds: removedIds, startAt: maxNum + 1 }) as POLine[];

    const updated = await updatePurchaseOrder(id, tenantId, { lines: withIds, updatedAt: new Date().toISOString() } as any);

    logger.info(logCtx, "po-patch-lines.saved", { poId: updated.id, added: summary.added, updated: summary.updated, removed: summary.removed, lineCount: (updated.lines || []).length });

    return json(200, updated);
  } catch (err: any) {
    logger.error({ requestId: reqIdOf(event) }, "po-patch-lines.error", { message: err?.message });
    return internalError(err, requestId);
  }
}
