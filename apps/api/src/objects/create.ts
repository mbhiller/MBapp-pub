import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

import { ok, bad, error } from "../common/responses";
import { createObject, buildSkuLock } from "./repo";
import { getAuth, requirePerm } from "../auth/middleware";
import { ensurePartyRole } from "../common/validators";
import { markPartyRole } from "../common/party";

const TABLE = process.env.MBAPP_OBJECTS_TABLE || process.env.MBAPP_TABLE || "mbapp_objects";
const PK    = process.env.MBAPP_TABLE_PK || "pk";
const SK    = process.env.MBAPP_TABLE_SK || "sk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    const type = event.pathParameters?.type;
    if (!type) return bad("Missing type");
    requirePerm(auth, `${type}:write`);

    const body = event.body ? JSON.parse(event.body) : {};
    body.type = type;

    // 1) SKU uniqueness (products only) — constant SK lock
    let lockedSku: string | undefined;
    if (String(type).toLowerCase() === "product" && body?.sku) {
      const lock = buildSkuLock(auth.tenantId, "pending", String(body.sku));
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: lock,
        ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
        ExpressionAttributeNames: { "#pk": PK, "#sk": SK },
      })).catch((e: any) => {
        if (e?.name === "ConditionalCheckFailedException") {
          throw Object.assign(new Error(`SKU already exists: ${body.sku}`), { statusCode: 409 });
        }
        throw e;
      });
      lockedSku = String(body.sku);
    }

    // 2) Tier-1 gate (SO/PO require party role)
    try {
      const t = String(type || "");
      const isSO = t.toLowerCase() === "salesorder";
      const isPO = t.toLowerCase() === "purchaseorder";
      if (isSO || isPO) {
        const pid = body?.partyId || body?.customerId || body?.vendorId;
        if (!pid) return bad("Missing partyId");
        await ensurePartyRole({ tenantId: auth.tenantId, partyId: String(pid), role: isSO ? "customer" : "vendor" });
      }
    } catch (e: any) {
      const msg = e?.message || "role_validation_failed";
      const sc  = e?.statusCode || 400;
      return { statusCode: sc, headers: { "content-type":"application/json" }, body: JSON.stringify({ message: msg }) };
    }

    // 3) Create the object
    const item = await createObject({ tenantId: auth.tenantId, type, body }) as { id: string } & Record<string, any>;

    // 4) Finalize the SKU lock with real productId (same PK/SK)
    if (lockedSku) {
      const final = buildSkuLock(auth.tenantId, item.id, lockedSku);
      await ddb.send(new PutCommand({ TableName: TABLE, Item: final })); // idempotent overwrite
    }

    // 5) Denorm party roles AFTER creation of partyRole object
    if (String(type).toLowerCase() === "partyrole") {
      const active = (body?.active ?? true) === true;
      const partyId = String(body?.partyId || "");
      const role = String(body?.role || "");
      if (partyId && role) {
        await markPartyRole({ tenantId: auth.tenantId, partyId, role, active });
      }
    }

    return ok(item);
  } catch (e: any) {
    return error(e);
  }
}
