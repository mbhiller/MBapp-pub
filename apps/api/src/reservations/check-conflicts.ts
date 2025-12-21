// apps/api/src/reservations/check-conflicts.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ok, badRequest, conflict } from "../common/responses";
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

/** Query all reservations for a resource with given status */
async function queryReservations(
  tenantId: string,
  resourceId: string,
  statuses: string[]
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
      // Only include reservations for this resource with allowed statuses
      if (item.resourceId === resourceId && statuses.includes(item.status)) {
        reservations.push(item);
      }
    }

    cursor = (res as any).LastEvaluatedKey;
  } while (cursor);

  return reservations;
}

/** Check if two time ranges overlap: (aStart < bEnd) && (bStart < aEnd) */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export async function handle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const auth = await getAuth(event);
    const flagEnabled = featureReservationsEnabled(event);
    if (!flagEnabled) {
      return conflict("Feature not enabled");
    }

    requirePerm(auth, "reservation:read");

    const body = event.body ? JSON.parse(event.body) : {};
    const { resourceId, startsAt, endsAt, excludeReservationId } = body;

    // Validate required fields
    if (!resourceId || typeof resourceId !== "string") {
      return badRequest("Missing or invalid resourceId");
    }
    if (!startsAt || typeof startsAt !== "string") {
      return badRequest("Missing or invalid startsAt");
    }
    if (!endsAt || typeof endsAt !== "string") {
      return badRequest("Missing or invalid endsAt");
    }

    // Parse and validate times
    const startDate = parseIso(startsAt);
    const endDate = parseIso(endsAt);
    if (!startDate) {
      return badRequest("Invalid startsAt format (expected ISO 8601)");
    }
    if (!endDate) {
      return badRequest("Invalid endsAt format (expected ISO 8601)");
    }
    if (startDate >= endDate) {
      return badRequest("startsAt must be before endsAt");
    }

    // Query existing reservations for this resource
    const existing = await queryReservations(auth.tenantId, resourceId, ["pending", "confirmed"]);

    // Filter for overlaps, excluding the optional reservation ID
    const conflicts = existing.filter((res) => {
      if (excludeReservationId && res.id === excludeReservationId) {
        return false;
      }
      const resStart = parseIso(res.startsAt);
      const resEnd = parseIso(res.endsAt);
      if (!resStart || !resEnd) return false;
      return overlaps(startDate, endDate, resStart, resEnd);
    });

    // Return 200 with conflicts array (can be empty)
    return ok({ conflicts });
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
