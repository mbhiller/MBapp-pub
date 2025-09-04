// backend/src/objects/create.ts
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto"; // Node 20+
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const method = evt?.requestContext?.http?.method ?? "POST";
    const pp = evt?.pathParameters ?? {};
    const typeParam = pp.type as string | undefined;
    const idParam   = pp.id as string | undefined;

    if (!typeParam) return bad("type is required");

    let body: any = {};
    if (evt?.body) {
      try { body = JSON.parse(evt.body); }
      catch { return bad("invalid JSON body"); }
    }
    if (!body?.name) return bad("name is required");

    // Route rules:
    // - POST /objects/{type}        -> server generates id
    // - PUT  /objects/{type}/{id}   -> client supplies id
    // - POST /objects/{type}/{id}   -> discourage (use PUT instead)
    if (method === "POST" && idParam) {
      return bad("use PUT /objects/{type}/{id} when supplying id");
    }

    const id  = method === "PUT" ? idParam! : ("obj_" + randomUUID());
    const now = new Date().toISOString();

    // Item shape compatible with GET + byId GSI
    const item = {
      pk:        `TENANT#${tenantId}#TYPE#${typeParam}`,
      sk:        `ID#${id}`,
      id,
      tenantId,
      type:      typeParam,
      name:      body.name,
      ...body, // keep extra fields (tags, metadata, integrations, etc.)
      id_tenant: `${id}#${tenantId}`,
      createdAt: now,
      updatedAt: now,
      // optional legacy indexes you were using; harmless to keep
      gsi1pk: `type#${typeParam}#tenant#${tenantId}`,
      gsi1sk: now,
      ...(body?.tags?.rfidEpc
        ? { gsi2pk: `tag#${body.tags.rfidEpc}`, gsi2sk: `tenant#${tenantId}` }
        : {}),
    };

    try {
      await ddb.send(new PutCommand({
        TableName: tableObjects,
        Item: item,
        ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
      }));
    } catch (e: any) {
      // If already exists, return 409 Conflict (idempotent protection)
      if (e?.name === "ConditionalCheckFailedException") {
        return {
          statusCode: 409,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "Object already exists", code: "Conflict" }),
        };
      }
      throw e;
    }

    // 201 + Location to canonical URL
    const location = canonicalBase(evt)
      + `/objects/${encodeURIComponent(typeParam)}/${encodeURIComponent(id)}`;

    return {
      statusCode: 201,
      headers: { "content-type": "application/json", "Location": location },
      body: JSON.stringify(item),
    };
  } catch (e) {
    console.error("CREATE object failed", e);
    return errResp();
  }
};

function canonicalBase(evt: any) {
  const domain = evt?.requestContext?.domainName ?? "";
  const stage  = evt?.requestContext?.stage;
  const proto  = evt?.headers?.["x-forwarded-proto"] ?? "https";
  const pathStage = !stage || stage === "$default" ? "" : `/${stage}`;
  return `${proto}://${domain}${pathStage}`;
}
