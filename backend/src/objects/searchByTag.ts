import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad } from "../common/responses";
import { getTenantId } from "../common/env";

export const handler = async (evt: any) => {
  const tenantId = getTenantId(evt);
  const tag = evt?.queryStringParameters?.tag;
  if (!tag) return bad("tag is required (rfid:<EPC> or qr:<code> or nfc:<uid>)");

  const [kind, val] = String(tag).split(":");
  if (!val) return bad("tag format must be kind:value");

  // For now we key all tags as 'tag#<value>' in GSI2
  const res = await ddb.send(new QueryCommand({
    TableName: tableObjects,
    IndexName: "gsi2",
    KeyConditionExpression: "gsi2pk = :p AND gsi2sk = :s",
    ExpressionAttributeValues: {
      ":p": `tag#${val}`,
      ":s": `tenant#${tenantId}`
    },
    Limit: 50,
  }));

  return ok(res.Items || []);
};