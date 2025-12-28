// apps/api/src/purchasing/po-approve.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { getPurchaseOrder, updatePurchaseOrder } from "../shared/db";
import { getObjectById } from "../objects/repo";
import { featureVendorGuardEnabled } from "../flags";
import { badRequest, conflictError, internalError, notFound } from "../common/responses";
import { logger } from "../common/logger";

const reqIdOf = (event: APIGatewayProxyEventV2) => (event.requestContext as any)?.requestId;

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = reqIdOf(event);
  const tenantId = (event as any)?.requestContext?.authorizer?.mbapp?.tenantId as string;
  const id = event.pathParameters?.id as string;
  const logCtx = { requestId, tenantId, route: event.rawPath ?? event.requestContext?.http?.path, method: event.requestContext?.http?.method };
  try {
    if (!tenantId || !id) return badRequest("Missing tenant or id", undefined, requestId);
    const po = await getPurchaseOrder(tenantId, id);
    if (!po) return notFound("PO not found", requestId);

    logger.info(logCtx, "po-approve.load", { poId: po.id, vendorId: po.vendorId, status: po.status });

    if (featureVendorGuardEnabled(event)) {
      if (!po.vendorId) return badRequest("Vendor required", { code: "VENDOR_REQUIRED" }, requestId);
      const party = await getObjectById({ tenantId, type: "party", id: String(po.vendorId) }).catch(() => null);
      const hasVendorRole = Array.isArray(party?.roles) && party.roles.includes("vendor");
      if (!hasVendorRole) return badRequest("Selected party is not a vendor", { code: "VENDOR_ROLE_MISSING" }, requestId);
    }

    if (po.status !== "submitted") {
      logger.warn(logCtx, "po-approve.guard", { poId: po.id, status: po.status });
      return conflictError("Only submitted can approve", { status: po.status }, requestId);
    }

    const updated = await updatePurchaseOrder(id, tenantId, { status: "approved" } as any);
    logger.info(logCtx, "po-approve.saved", { poId: po.id, before: po.status, after: "approved" });
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(updated) };
  } catch (err: any) {
    logger.error(logCtx, "po-approve.error", { message: err?.message });
    return internalError(err, requestId);
  }
}
