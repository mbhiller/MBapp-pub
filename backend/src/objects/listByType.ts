import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad } from "../common/responses";
import { getTenantId } from "../common/env";

export const handler = async (evt: any) => {
  const tenantId = getTenantId(evt);
  const type = evt?.queryStringParameters?.type;
  if (!type) return bad("type query param is required");

  const res = await ddb.send(new QueryCommand({
    TableName: tableObjects,
    IndexName: "gsi1",
    KeyConditionExpression: "gsi1pk = :p",
    ExpressionAttributeValues: { ":p": `type#${type}#tenant#${tenantId}` },
    ScanIndexForward: false, // newest first by gsi1sk = updatedAt
    Limit: 100,
  }));

  return ok(res.Items || []);
};