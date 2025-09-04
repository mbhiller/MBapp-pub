// backend/src/objects/create.ts
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, notfound, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const method = evt?.requestContext?.http?.method ?? "POST";
    const pp = evt?.pathParameters ?? {};
    const type = (pp.type as string | undefined)?.trim();
    const idParam = (pp.id as string | undefined)?.trim();
    if (!type) return bad("type is required");

    let body: any = {};
    if (evt?.body) {
      try { body = typeof evt.body === "string" ? JSON.parse(evt.body) : evt.body; }
      catch { return bad("invalid JSON body"); }
    }

    // === PUT /objects/{type}/{id}  -> update existing (no create on PUT)
    if (method === "PUT") {
      if (!idParam) return bad("id is required for PUT");

      const pk = `TENANT#${tenantId}#TYPE#${type}`;
      const sk = `ID#${idParam}`;

      // ensure item exists
      const cur = await ddb.send(new GetCommand({ TableName: tableObjects, Key: { pk, sk } }));
      if (!cur.Item) return notfound("object not found");

      const now = new Date().toISOString();
      const names: Record<string,string> = { "#updatedAt": "updatedAt" };
      const values: Record<string,any>   = { ":updatedAt": now };
      const sets: string[]               = ["#updatedAt = :updatedAt"];

      if (body.name !== undefined)         { names["#name"] = "name";                 values[":name"] = body.name;                 sets.push("#name = :name"); }
      if (body.tags !== undefined)         { names["#tags"] = "tags";                 values[":tags"] = body.tags;                 sets.push("#tags = :tags"); }
      if (body.integrations !== undefined) { names["#integrations"] = "integrations"; values[":integrations"] = body.integrations; sets.push("#integrations = :integrations"); }

      await ddb.send(new UpdateCommand({
        TableName: tableObjects,
        Key: { pk, sk },
        UpdateExpression: "SET " + sets.join(", "),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)", // update-only
        ReturnValues: "ALL_NEW"
      }));

      return ok({ id: idParam, updated: true });
    }

    // === POST /objects/{type}  -> create new (server generates id)
    if (idParam) return bad("use PUT /objects/{type}/{id} when supplying id");
    if (!body?.name) return bad("name is required");

    const id  = randomUUID();
    const now = new Date().toISOString();

    const item = {
      pk:        `TENANT#${tenantId}#TYPE#${type}`,
      sk:        `ID#${id}`,
      id,
      tenantId,
      type,
      name:      body.name,
      ...body, // tags, metadata, integrations, etc.
      id_tenant: `${id}#${tenantId}`,
      createdAt: now,
      updatedAt: now,
      // legacy/aux GSIs (optional)
      gsi1pk: `type#${type}#tenant#${tenantId}`,
      gsi1sk: now,
      ...(body?.tags?.rfidEpc ? { gsi2pk: `tag#${body.tags.rfidEpc}`, gsi2sk: `tenant#${tenantId}` } : {}),
    };

    await ddb.send(new PutCommand({
      TableName: tableObjects,
      Item: item,
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)", // idempotent create
    }));

    const location = canonicalBase(evt) + `/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
    return {
      statusCode: 201,
      headers: { "content-type": "application/json", "Location": location },
      body: JSON.stringify(item),
    };
  } catch (e) {
    console.error("CREATE object failed", e);
    return errResp(e);
  }
};

function canonicalBase(evt: any) {
  const domain = evt?.requestContext?.domainName ?? "";
  const stage  = evt?.requestContext?.stage;
  const proto  = evt?.headers?.["x-forwarded-proto"] ?? "https";
  const pathStage = !stage || stage === "$default" ? "" : `/${stage}`;
  return `${proto}://${domain}${pathStage}`;
}
