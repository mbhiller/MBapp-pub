import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getAuth, requirePerm } from "../auth/middleware";
import { ok, error } from "../common/responses";
import { QueryCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const TABLE   = process.env.MBAPP_OBJECTS_TABLE || "mbapp_objects";
const PK_ATTR = process.env.MBAPP_TABLE_PK || "pk";
const SK_ATTR = process.env.MBAPP_TABLE_SK || "sk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "admin:reset");

    // Scan-by-partition via Query on pk = tenantId
    const limit = Number(event.queryStringParameters?.limit ?? 500);
    const next  = event.queryStringParameters?.next
      ? JSON.parse(Buffer.from(String(event.queryStringParameters.next), "base64").toString("utf8"))
      : undefined;

    const res = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "#pk = :tenant",
      ExpressionAttributeNames: { "#pk": PK_ATTR },
      ExpressionAttributeValues: { ":tenant": auth.tenantId },
      ExclusiveStartKey: next,
      Limit: limit,
    }));

    const items = (res.Items || []).map((it: any) => ({
      pk: it[PK_ATTR],
      sk: it[SK_ATTR],
      id: it.id,
      type: it.type,
    }));

    const nextToken = res.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(res.LastEvaluatedKey), "utf8").toString("base64")
      : undefined;

    return ok({ items, next: nextToken });
  } catch (e:any) { return error(e); }
}
export default { handle };
