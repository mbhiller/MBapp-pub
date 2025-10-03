import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

import { ok, bad, notfound, error } from "../common/responses";
import { getObjectById, updateObject, buildSkuLock } from "./repo";
import { getAuth, requirePerm } from "../auth/middleware";

// Match repo.ts envs
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

    // === SKU uniqueness (products only) on change ===
    if (type === "product") {
      const oldSku = (existing as any)?.sku;
      const newSku = patch?.sku;

      if (newSku && newSku !== oldSku) {
        // Acquire new lock (fail if taken)
        const newLock = buildSkuLock(auth.tenantId, id, String(newSku));
        await ddb.send(new PutCommand({
          TableName: TABLE,
          Item: newLock,
          ConditionExpression: `attribute_not_exists(#pk) AND attribute_not_exists(#sk)`,
          ExpressionAttributeNames: { "#pk": PK, "#sk": SK },
        })).catch((e: any) => {
          if (e?.name === "ConditionalCheckFailedException") {
            throw Object.assign(new Error(`SKU already exists: ${newSku}`), { statusCode: 409 });
          }
          throw e;
        });

        // Release old lock if there was one
        if (oldSku) {
          await ddb.send(new DeleteCommand({
            TableName: TABLE,
            Key: {
              [PK]: `UNIQ#${auth.tenantId}#product#SKU#${oldSku}`,
              [SK]: `${auth.tenantId}|product|${id}`,
            },
          })).catch(() => {});
        }
      }
    }

    const updated = await updateObject({ tenantId: auth.tenantId, type, id, body: patch });
    return ok(updated);
  } catch (e: any) {
    return error(e);
  }
}
