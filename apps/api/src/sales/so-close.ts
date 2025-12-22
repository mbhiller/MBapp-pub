import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { getSalesOrder, updateSalesOrder } from "../shared/db";
import { assertSoClosable } from "../shared/statusGuards";

const json = (s: number, b: unknown): APIGatewayProxyResultV2 => ({ statusCode: s, headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const id = event.pathParameters?.id as string;
    const tenantId = (event as any)?.requestContext?.authorizer?.mbapp?.tenantId as string;
    const so = await getSalesOrder(tenantId, id);

    assertSoClosable(so.status);

    const updated = await updateSalesOrder(id, tenantId, { status: "closed" } as any);
    return json(200, updated);
  } catch (err: any) {
    const statusCode = err?.statusCode ?? 500;
    return json(statusCode, { message: err?.message ?? "Internal Server Error" });
  }
}
