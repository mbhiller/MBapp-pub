// apps/api/src/sales/so-cancel.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ddb, tableObjects } from "../common/ddb";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { assertSoCancelable } from "../shared/statusGuards";
import { netReservationsForSO } from "../shared/reservationSummary";

type SalesOrder = {
  pk: string; sk: string; id: string; type: "salesOrder";
  status: "draft"|"submitted"|"approved"|"committed"|"partially_fulfilled"|"fulfilled"|"cancelled"|"closed";
  [k: string]: any;
};

const json = (s: number, b: unknown): APIGatewayProxyResultV2 => ({
  statusCode: s,
  headers: {
    "content-type":"application/json",
    "access-control-allow-origin":"*",
    "access-control-allow-methods":"OPTIONS,GET,POST,PUT,DELETE",
    "access-control-allow-headers":"Authorization,Content-Type,Idempotency-Key,X-Tenant-Id,Accept",
  },
  body: JSON.stringify(b)
});
const tid = (e: APIGatewayProxyEventV2) =>
  (e as any)?.requestContext?.authorizer?.mbapp?.tenantId || (e.headers?.["X-Tenant-Id"] as string) || "";

async function loadSO(tenantId: string, id: string): Promise<SalesOrder|null> {
  const res = await ddb.send(new GetCommand({ TableName: tableObjects, Key: { pk: tenantId, sk: `salesOrder#${id}` } }));
  return (res.Item as SalesOrder) ?? null;
}

/** Compute net reservations and presence of fulfillments for this SO. */


export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const tenantId = tid(event);
    const id = event.pathParameters?.id;
    if (!tenantId || !id) return json(400, { message: "Missing tenant or id" });

    const so = await loadSO(tenantId, id);
    if (!so) return json(404, { message: "Sales order not found" });

    const { net, fulfilled } = await netReservationsForSO(tenantId, so.id);
    const hasReservations = net > 0;
    const hasFulfillments = fulfilled;


    // Enforce guardrails (will 409 accordingly)
    assertSoCancelable(so.status as any, hasReservations, hasFulfillments);

    const updated = { ...so, status: "cancelled", updatedAt: new Date().toISOString() };
    await ddb.send(new PutCommand({ TableName: tableObjects, Item: updated }));
    return json(200, updated);
  } catch (err: any) {
    const statusCode = err?.statusCode ?? 500;
    return json(statusCode, { message: err?.message ?? "Internal Server Error" });
  }
}
