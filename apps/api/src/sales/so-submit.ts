import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { getSalesOrder, updateSalesOrder } from "../shared/db";

const json = (s: number, b: unknown): APIGatewayProxyResultV2 => ({ statusCode: s, headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id as string;
  const tenantId = (event as any)?.requestContext?.authorizer?.mbapp?.tenantId as string;
  const so = await getSalesOrder(tenantId, id);
  if (so.status !== "draft") return json(409, { message: "Only draft can submit" });
  const updated = await updateSalesOrder(id, tenantId, { status: "submitted" } as any);
  return json(200, updated);
}
