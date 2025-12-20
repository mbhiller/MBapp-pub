import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

import { ok, bad, notFound, error } from "../common/responses";
import { getObjectById, deleteObject } from "./repo";
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

    const existing = await getObjectById({ tenantId: auth.tenantId, type, id });
    if (!existing) return notFound("Not Found");

    // If product has a SKU, release its uniqueness lock
    if (type === "product" && (existing as any)?.sku) {
      const sku = String((existing as any).sku);
      await ddb.send(new DeleteCommand({
        TableName: TABLE,
        Key: {
          [PK]: `UNIQ#${auth.tenantId}#product#SKU#${sku}`,
          [SK]: `${auth.tenantId}|product|${id}`,
        },
      })).catch(() => {});
    }

    await deleteObject({ tenantId: auth.tenantId, type, id });
    return ok({ ok: true, id, type, deleted: true });
  } catch (e: any) {
    return error(e);
  }
}
