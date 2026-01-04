// apps/api/src/purchasing/po-patch-lines.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { resolveTenantId } from "../common/tenant";
import { badRequest, conflictError, internalError, notFound } from "../common/responses";
import { logger } from "../common/logger";
import { getPurchaseOrder, updatePurchaseOrder, type PurchaseOrder } from "../shared/db";
import { type PatchLineOp } from "../shared/patchLines";
import { PatchLinesValidationError } from "../shared/patchLinesEngine";
import { applyPatchLinesAndEnsureIds } from "../shared/line-editing";

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

const PATCH_OPTIONS = {
  entityLabel: "purchaseOrder",
  editableStatuses: ["draft"],
  patchableFields: ["itemId", "qty", "uom"],
} as const;

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = reqIdOf(event);
  const baseCtx = { requestId };
  let logCtx: Record<string, unknown> = baseCtx;
  let po: PurchaseOrder | null = null;
  try {
    const tenantId = resolveTenantId(event);
    const id = event.pathParameters?.id;
    if (!tenantId || !id) return badRequest("Missing tenant or id", undefined, requestId);
    logCtx = { ...baseCtx, tenantId, route: event.rawPath ?? (event.requestContext as any)?.http?.path, method: (event.requestContext as any)?.http?.method };

    const ops = parseOps(event);
    if (!ops) {
      logger.warn(logCtx, "po-patch-lines.bad-body", { reason: "missing_ops" });
      return badRequest("Body must include ops[]", undefined, requestId);
    }

    try {
      po = await getPurchaseOrder(tenantId, id);
    } catch (err: any) {
      if ((err?.statusCode ?? 0) === 404) return notFound("Purchase order not found", requestId);
      return internalError(err, requestId);
    }

    const { lines: normalizedLines } = applyPatchLinesAndEnsureIds<POLine>(po, ops, PATCH_OPTIONS);
    const updated = await updatePurchaseOrder(id, tenantId, { lines: normalizedLines, updatedAt: new Date().toISOString() } as any);

    logger.info(logCtx, "po-patch-lines.saved", { poId: updated.id, lineCount: (updated.lines || []).length });

    return json(200, updated);
  } catch (err: any) {
    if (err instanceof PatchLinesValidationError) {
      if (err.statusCode === 409) {
        logger.warn(logCtx, "po-patch-lines.guard", { status: po?.status });
        return conflictError(err.message, { code: err.code, status: po?.status }, requestId);
      }
      return badRequest(err.message, { code: err.code, details: err.details }, requestId);
    }
    logger.error({ requestId: reqIdOf(event) }, "po-patch-lines.error", { message: err?.message });
    return internalError(err, requestId);
  }
}
