// apps/api/src/resources/availability.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ok, badRequest, notFound } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { featureReservationsEnabled } from "../flags";

const TABLE = process.env.MBAPP_OBJECTS_TABLE || process.env.MBAPP_TABLE || "mbapp_objects";
const PK = process.env.MBAPP_TABLE_PK || "pk";
const SK = process.env.MBAPP_TABLE_SK || "sk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Helper to parse ISO datetime and validate */
function parseIso(s: string): Date | null {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Get a resource by ID */
async function getResource(tenantId: string, resourceId: string): Promise<any | null> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: {
        [PK]: tenantId,
        [SK]: `resource#${resourceId}`,
      },
    })
  );
  return res.Item ?? null;
}

/** Query all reservations for a resource within a time range */
async function queryReservationsInRange(
  tenantId: string,
  resourceId: string,
  fromDate: Date,
  toDate: Date
): Promise<any[]> {
  const reservations: any[] = [];
  let cursor: any = undefined;

  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sk)",
        ExpressionAttributeNames: { "#pk": PK, "#sk": SK },
        ExpressionAttributeValues: { ":pk": tenantId, ":sk": "reservation#" },
        ExclusiveStartKey: cursor,
      } as any)
    );

    for (const item of (res.Items ?? []) as any[]) {
      // Only include reservations for this resource with confirmed/pending status
      if (item.resourceId === resourceId && ["pending", "confirmed"].includes(item.status)) {
        const resStart = parseIso(item.startsAt);
        const resEnd = parseIso(item.endsAt);
        // Include if overlaps with requested time range: (resStart < toDate) && (fromDate < resEnd)
        if (resStart && resEnd && resStart < toDate && fromDate < resEnd) {
          reservations.push(item);
        }
      }
    }

    cursor = (res as any).LastEvaluatedKey;
  } while (cursor);

  return reservations;
}

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const auth = await getAuth(event);
    const flagEnabled = featureReservationsEnabled(event);
    if (!flagEnabled) {
      return badRequest("Feature not enabled");
    }

    requirePerm(auth, "resource:read");

    const resourceId = event.pathParameters?.id;
    if (!resourceId) {
      return badRequest("Missing resource id");
    }

    // Get from and to query params
    const fromStr = event.queryStringParameters?.from;
    const toStr = event.queryStringParameters?.to;

    if (!fromStr || typeof fromStr !== "string") {
      return badRequest("Missing or invalid from query parameter (expected ISO 8601)");
    }
    if (!toStr || typeof toStr !== "string") {
      return badRequest("Missing or invalid to query parameter (expected ISO 8601)");
    }

    const fromDate = parseIso(fromStr);
    const toDate = parseIso(toStr);

    if (!fromDate) {
      return badRequest("Invalid from format (expected ISO 8601)");
    }
    if (!toDate) {
      return badRequest("Invalid to format (expected ISO 8601)");
    }
    if (fromDate >= toDate) {
      return badRequest("from must be before to");
    }

    // Check that resource exists
    const resource = await getResource(auth.tenantId, resourceId);
    if (!resource) {
      return notFound(`Resource not found: ${resourceId}`);
    }

    // Query busy periods in range
    const busy = await queryReservationsInRange(auth.tenantId, resourceId, fromDate, toDate);

    return ok({ busy });
  } catch (e: any) {
    const status = e?.statusCode ?? 500;
    const message = e?.message ?? "Internal Server Error";
    if (status === 401)
      return {
        statusCode: 401,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "unauthorized", message }),
      };
    if (status === 403)
      return {
        statusCode: 403,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "forbidden", message }),
      };
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "internal_error", message }),
    };
  }
}
