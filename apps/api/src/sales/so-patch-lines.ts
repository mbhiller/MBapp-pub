// apps/api/src/sales/so-patch-lines.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects, type OrderStatus } from "../common/ddb";
import { resolveTenantId } from "../common/tenant";
import { badRequest, conflictError, internalError, notFound } from "../common/responses";
import { logger } from "../common/logger";
import { type PatchLineOp } from "../shared/patchLines";
import { runPatchLinesEngine, PatchLinesValidationError } from "../shared/patchLinesEngine";

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

const PATCH_OPTIONS = {
  entityLabel: "salesOrder",
  editableStatuses: ["draft"],
  patchableFields: ["itemId", "qty", "uom"],
} as const;

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = reqIdOf(event);
  const baseCtx = { requestId };
  let logCtx: Record<string, unknown> = baseCtx;
  let so: SalesOrder | null = null;
  try {
    const tenantId = resolveTenantId(event);
    const id = event.pathParameters?.id;
    if (!tenantId || !id) return badRequest("Missing tenant or id", undefined, requestId);
    logCtx = { ...baseCtx, tenantId, route: event.rawPath ?? (event.requestContext as any)?.http?.path, method: (event.requestContext as any)?.http?.method };

    const ops = parseOps(event);
    if (!ops) {
      logger.warn(logCtx, "so-patch-lines.bad-body", { reason: "missing_ops" });
      return badRequest("Body must include ops[]", undefined, requestId);
    }

    so = await loadSO(tenantId, id);
    if (!so) return notFound("Sales order not found", requestId);

    const { nextLines } = runPatchLinesEngine<SOLine>({ currentDoc: so, ops, options: PATCH_OPTIONS });

    so.lines = nextLines;
    await saveSO(so);

    logger.info(logCtx, "so-patch-lines.saved", { soId: so.id, lineCount: (so.lines || []).length });

    return json(200, so);
  } catch (err: any) {
    if (err instanceof PatchLinesValidationError) {
      if (err.statusCode === 409) {
        logger.warn(logCtx, "so-patch-lines.guard", { status: so?.status });
        return conflictError(err.message, { code: err.code, status: so?.status }, requestId);
      }
      return badRequest(err.message, { code: err.code, details: err.details }, requestId);
    }
    logger.error({ requestId: reqIdOf(event) }, "so-patch-lines.error", { message: err?.message });
    return internalError(err, requestId);
  }
}
