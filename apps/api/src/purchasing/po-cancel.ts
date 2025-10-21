import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { getPurchaseOrder, updatePurchaseOrder } from "../shared/db";

const json = (s: number, b: unknown): APIGatewayProxyResultV2 => ({ statusCode: s, headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id as string;
  const tenantId = (event as any)?.requestContext?.authorizer?.mbapp?.tenantId as string;
  const po = await getPurchaseOrder(tenantId, id);
  if (po.status !== "draft" && po.status !== "submitted") return json(409, { message: "Only draft/submitted can cancel" });
  const updated = await updatePurchaseOrder(id, tenantId, { status: "cancelled" } as any);
  return json(200, updated);
}
