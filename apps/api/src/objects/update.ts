import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

import { ok, bad, notFound, error } from "../common/responses";
import { updateObject, buildSkuLock } from "./repo";
import { resolveObjectByIdWithAliases, normalizeTypeParam } from "./type-alias";
import { getAuth, requirePerm } from "../auth/middleware";
import { ensurePartyRole } from "../common/validators";
import { featureReservationsEnabled } from "../flags";

const MOVEMENT_ACTIONS = new Set(["receive","reserve","commit","fulfill","adjust","release"]);
const TABLE = process.env.MBAPP_OBJECTS_TABLE || process.env.MBAPP_TABLE || "mbapp_objects";
const PK    = process.env.MBAPP_TABLE_PK || "pk";
const SK    = process.env.MBAPP_TABLE_SK || "sk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const type = event.pathParameters?.type;
    const id   = event.pathParameters?.id;
    if (!type || !id) return bad("Missing type or id");

    // Permission already checked by router via requireObjectPerm()

    const patch = event.body ? JSON.parse(event.body) : {};
    const resolved = await resolveObjectByIdWithAliases({ tenantId: auth.tenantId, type, id });
    if (!resolved) return notFound("Not Found");
    const { typeUsed, obj: existing } = resolved;
    
    // Canonicalize type to handle alias resolution (e.g., "inventory" → "inventoryItem")
    const canonicalTypeUsed = normalizeTypeParam(typeUsed) ?? typeUsed;

    // 1) Product SKU change → acquire new lock and delete old constant-SK lock
    if (canonicalTypeUsed === "product") {
      const oldSku = (existing as any)?.sku;
      const newSku = patch?.sku;
      if (newSku && newSku !== oldSku) {
        const newLock = buildSkuLock(auth.tenantId, id, String(newSku));
        await ddb.send(new PutCommand({
          TableName: TABLE,
          Item: newLock,
          ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
          ExpressionAttributeNames: { "#pk": PK, "#sk": SK },
        })).catch((e: any) => {
          if (e?.name === "ConditionalCheckFailedException") {
            throw Object.assign(new Error(`SKU already exists: ${newSku}`), { statusCode: 409 });
          }
          throw e;
        });

        if (oldSku) {
          await ddb.send(new DeleteCommand({
            TableName: TABLE,
            Key: {
              [PK]: `UNIQ#${auth.tenantId}#product#SKU#${oldSku}`,
              [SK]: `SKU`,
            },
          })).catch(() => {});
        }
      }
    }

    // 2) Tier-1 gate on update (SO/PO require party role)
    try {
      const isSO = canonicalTypeUsed === "salesOrder";
      const isPO = canonicalTypeUsed === "purchaseOrder";
      if (isSO || isPO) {
        let pid = patch?.partyId as string | undefined;
        if (!pid) {
          pid = (existing as any)?.partyId || (existing as any)?.customerId || (existing as any)?.vendorId;
        }
        if (!pid) return bad("Missing partyId");
        await ensurePartyRole({ tenantId: auth.tenantId, partyId: String(pid), role: isSO ? "customer" : "vendor" });
      }
    } catch (e: any) {
      const msg = e?.message || "role_validation_failed";
      const sc  = e?.statusCode || 400;
      return { statusCode: sc, headers: { "content-type":"application/json" }, body: JSON.stringify({ message: msg }) };
    }

    // 3) Reservation overlap check (on update, if time fields are being changed)
    if (canonicalTypeUsed === "reservation") {
      if (!featureReservationsEnabled(event)) {
        return { statusCode: 403, headers: { "content-type":"application/json" }, body: JSON.stringify({ message: "Feature not enabled" }) };
      }
      
      // Use patch values if provided, otherwise fall back to existing
      const resourceId = (patch?.resourceId ?? (existing as any)?.resourceId) as string | undefined;
      const startsAt = (patch?.startsAt ?? (existing as any)?.startsAt) as string | undefined;
      const endsAt = (patch?.endsAt ?? (existing as any)?.endsAt) as string | undefined;
      
      if (!resourceId) return bad("Missing resourceId");
      if (!startsAt) return bad("Missing startsAt");
      if (!endsAt) return bad("Missing endsAt");
      
      const startDate = new Date(startsAt);
      const endDate = new Date(endsAt);
      if (isNaN(startDate.getTime())) return bad("Invalid startsAt (expected ISO 8601)");
      if (isNaN(endDate.getTime())) return bad("Invalid endsAt (expected ISO 8601)");
      if (startDate >= endDate) return bad("startsAt must be before endsAt");
      
      // Query existing reservations for this resource, excluding current reservation
      let cursor: any = undefined;
      const conflicts: any[] = [];
      do {
        const res = await ddb.send(new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sk)",
          ExpressionAttributeNames: { "#pk": PK, "#sk": SK },
          ExpressionAttributeValues: { ":pk": auth.tenantId, ":sk": "reservation#" },
          ExclusiveStartKey: cursor,
        } as any));
        for (const item of (res.Items ?? []) as any[]) {
          if (item.id === id) continue; // Exclude current reservation
          if (item.resourceId !== resourceId || !["pending", "confirmed"].includes(item.status)) continue;
          const resStart = new Date(item.startsAt);
          const resEnd = new Date(item.endsAt);
          if (isNaN(resStart.getTime()) || isNaN(resEnd.getTime())) continue;
          if (startDate < resEnd && resStart < endDate) {
            conflicts.push({ id: item.id, startsAt: item.startsAt, endsAt: item.endsAt });
          }
        }
        cursor = (res as any).LastEvaluatedKey;
      } while (cursor);
      
      if (conflicts.length > 0) {
        return {
          statusCode: 409,
          headers: { "content-type":"application/json" },
          body: JSON.stringify({
            code: "conflict",
            message: `Reservation conflicts with ${conflicts.length} existing booking(s)`,
            details: { conflicts: conflicts.map(c => ({ id: c.id, startsAt: c.startsAt, endsAt: c.endsAt })) }
          })
        };
      }
    }

    // 3) Apply update
    // If updating an inventory movement, validate action (when provided) and keep canonical markers.
    if (canonicalTypeUsed === "inventoryMovement") {
      if (Object.prototype.hasOwnProperty.call(patch, "action")) {
        const a = String(patch?.action ?? "").toLowerCase();
        if (!MOVEMENT_ACTIONS.has(a)) {
          return bad("invalid action");
        }
        patch.action = a;
      }
      patch.type = "inventoryMovement";
      patch.docType = "inventoryMovement";
    }
    
    const updated = await updateObject({ tenantId: auth.tenantId, type: typeUsed, id, body: patch });
    
    return ok(updated);
  } catch (e: any) {
    return error(e);
  }
}
