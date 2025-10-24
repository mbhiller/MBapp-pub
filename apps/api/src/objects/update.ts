import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

import { ok, bad, notfound, error } from "../common/responses";
import { getObjectById, updateObject, buildSkuLock } from "./repo";
import { markPartyRole } from "../common/party";
import { getAuth, requirePerm } from "../auth/middleware";
import { ensurePartyRole } from "../common/validators";

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

    requirePerm(auth, `${type}:write`);

    const patch = event.body ? JSON.parse(event.body) : {};
    const existing = await getObjectById({ tenantId: auth.tenantId, type, id });
    if (!existing) return notfound("Not Found");

    // 1) Product SKU change → acquire new lock and delete old constant-SK lock
    if (String(type).toLowerCase() === "product") {
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
      const t = String(type || "");
      const isSO = t.toLowerCase() === "salesorder";
      const isPO = t.toLowerCase() === "purchaseorder";
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

    // 3) Apply update
    // If updating an inventory movement, validate action (when provided) and keep canonical markers.
    if (String(type).toLowerCase() === "inventorymovement") {
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
    
    const updated = await updateObject({ tenantId: auth.tenantId, type, id, body: patch });
    
    // 4) If we updated a partyRole, keep Party.roleFlags in sync
    if (String(type).toLowerCase() === "partyrole") {
      const partyId: string | undefined =
        patch?.partyId ?? (updated as any)?.partyId ?? (existing as any)?.partyId;
      const role: string | undefined =
        patch?.role    ?? (updated as any)?.role    ?? (existing as any)?.role;
      const active: boolean =
        (patch?.active ?? (updated as any)?.active ?? (existing as any)?.active ?? true) === true;
      if (partyId && role) {
        await markPartyRole({ tenantId: auth.tenantId, partyId, role, active });
      }
    }

    return ok(updated);
  } catch (e: any) {
    return error(e);
  }
}
