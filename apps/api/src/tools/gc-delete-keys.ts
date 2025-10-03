import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getAuth, requirePerm } from "../auth/middleware";
import { ok, bad, error } from "../common/responses";
import { DeleteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const TABLE   = process.env.MBAPP_OBJECTS_TABLE || "mbapp_objects";
const PK_ATTR = process.env.MBAPP_TABLE_PK || "pk";
const SK_ATTR = process.env.MBAPP_TABLE_SK || "sk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "admin:reset");

    const body = event.body ? JSON.parse(event.body) as { keys?: Array<{ pk: string; sk: string }> } : {};
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (keys.length === 0) return bad("keys required");

    let deleted = 0;
    for (const k of keys) {
      // Defensive: only allow deletes in this tenant partition
      if (k.pk !== auth.tenantId) continue;
      await ddb.send(new DeleteCommand({
        TableName: TABLE,
        Key: { [PK_ATTR]: k.pk, [SK_ATTR]: k.sk },
      }));
      deleted++;
    }
    return ok({ deleted });
  } catch (e:any) { return error(e); }
}
export default { handle };
