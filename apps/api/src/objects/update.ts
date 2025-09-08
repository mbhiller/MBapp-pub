import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, notfound, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const type = evt?.pathParameters?.type?.trim();
    const id   = evt?.pathParameters?.id?.trim();
    if (!type) return bad("type is required");
    if (!id)   return bad("id is required");

    let body: any = {};
    if (evt?.body) {
      try { body = typeof evt.body === "string" ? JSON.parse(evt.body) : evt.body; }
      catch { return bad("invalid JSON body"); }
    }

    const pk = `TENANT#${tenantId}#TYPE#${type}`;
    const sk = `ID#${id}`;

    // verify target exists
    const cur = await ddb.send(new GetCommand({
      TableName: tableObjects,
      Key: { pk, sk },
      ConsistentRead: true
    }));
    if (!cur.Item) return notfound("object not found");
    if (cur.Item.type !== type) return bad("type mismatch for this id", "409");

    const now = new Date().toISOString();
    const names: Record<string,string> = { "#updatedAt": "updatedAt" };
    const values: Record<string,any>   = { ":updatedAt": now };
    const sets: string[] = ["#updatedAt = :updatedAt"];

    if (body.name !== undefined) {
      names["#name"] = "name"; values[":name"] = body.name; sets.push("#name = :name");
    }
    if (body.tags !== undefined) {
      names["#tags"] = "tags"; values[":tags"] = body.tags; sets.push("#tags = :tags");
    }
    if (body.integrations !== undefined) {
      names["#integrations"] = "integrations"; values[":integrations"] = body.integrations; sets.push("#integrations = :integrations");
    }

    await ddb.send(new UpdateCommand({
      TableName: tableObjects,
      Key: { pk, sk },
      UpdateExpression: "SET " + sets.join(", "),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
      ReturnValues: "ALL_NEW"
    }));

    return ok({ id, updated: true });
  } catch (e: unknown) {
    console.error("update.ts error", e);
    const msg = e instanceof Error ? e.message : String(e);
    return errResp(msg);
  }
};
