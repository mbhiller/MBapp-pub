import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  DynamoDBDocumentClient,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

import { ok, bad, error } from "../common/responses";
import { createObject, buildSkuLock } from "./repo";
import { getAuth, requirePerm } from "../auth/middleware";

// Reuse the same env names that repo.ts uses
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
    // Enforce route type
    body.type = type;

    // === SKU uniqueness (products only) ===
    // If a SKU is present, acquire a uniqueness lock BEFORE creating the product.
    if (type === "product" && body?.sku) {
      const lock = buildSkuLock(auth.tenantId, body.id || "pending", String(body.sku));
      // Conditional put: only succeed if no existing item at this PK (unique)
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: lock,
        ConditionExpression: `attribute_not_exists(#pk) AND attribute_not_exists(#sk)`,
        ExpressionAttributeNames: { "#pk": PK, "#sk": SK },
      })).catch((e: any) => {
        // ConditionalCheckFailedException => conflict
        if (e?.name === "ConditionalCheckFailedException") {
          throw Object.assign(new Error(`SKU already exists: ${body.sku}`), { statusCode: 409 });
        }
        throw e;
      });
    }

    // Create the object (repo computes pk/sk = tenantId + type#id)
    const item = await createObject({ tenantId: auth.tenantId, type, body }) as { id: string } & Record<string, any>;

    // If we locked with a "pending id", we should re-write the lock with the real id.
    if (type === "product" && body?.sku) {
      const finalLock = buildSkuLock(auth.tenantId, item.id, String(body.sku));
      await ddb.send(new PutCommand({ TableName: TABLE, Item: finalLock }));
    }

    return ok(item);
  } catch (e: any) {
    return error(e);
  }
}
