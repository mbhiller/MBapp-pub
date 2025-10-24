// /apps/src/api/purchasing/po-submit.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { getPurchaseOrder, updatePurchaseOrder } from "../shared/db";
import { getObjectById } from "../objects/repo";
import { featureVendorGuardEnabled } from "../flags";

const json = (s: number, b: unknown): APIGatewayProxyResultV2 => ({ statusCode: s, headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id as string;
  const tenantId = (event as any)?.requestContext?.authorizer?.mbapp?.tenantId as string;
  const po = await getPurchaseOrder(tenantId, id);
  if (featureVendorGuardEnabled(event)) {
    if (!po.vendorId) return json(400, { message: "Vendor required", code: "VENDOR_REQUIRED" });
    const party = await getObjectById({ tenantId, type: "party", id: String(po.vendorId) }).catch(() => null);
    const hasVendorRole = Array.isArray(party?.roles) && party.roles.includes("vendor");
    if (!hasVendorRole) return json(400, { message: "Selected party is not a vendor", code: "VENDOR_ROLE_MISSING" });
  }

  if (po.status !== "draft") return json(409, { message: "Only draft can submit" });
  const updated = await updatePurchaseOrder(id, tenantId, { status: "submitted" } as any);
  return json(200, updated);
}
