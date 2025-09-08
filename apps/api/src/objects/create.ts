import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const method = evt?.requestContext?.http?.method ?? "POST";
    if (method !== "POST") return bad("use POST /objects/{type} for create");

    const type = (evt?.pathParameters?.type as string | undefined)?.trim();
    if (!type) return bad("type is required");

    let body: any = {};
    if (evt?.body) {
      try { body = typeof evt.body === "string" ? JSON.parse(evt.body) : evt.body; }
      catch { return bad("invalid JSON body"); }
    }
    if (!body?.name) return bad("name is required");

    const id = randomUUID();
    const now = new Date().toISOString();

    const item = {
      pk: `TENANT#${tenantId}#TYPE#${type}`,
      sk: `ID#${id}`,
      id,
      tenantId,
      type,
      name: body.name,
      ...body, // tags, metadata, etc.
      id_tenant: `${id}#${tenantId}`,
      createdAt: now,
      updatedAt: now,
      gsi1pk: `type#${type}#tenant#${tenantId}`,
      gsi1sk: now,
      ...(body?.tags?.rfidEpc
        ? { gsi2pk: `tag#${body.tags.rfidEpc}`, gsi2sk: `tenant#${tenantId}` }
        : {}),
    };

    await ddb.send(new PutCommand({
      TableName: tableObjects,
      Item: item,
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
    }));

    const location =
      canonicalBase(evt) + `/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;

    return {
      statusCode: 201,
      headers: { "content-type": "application/json", Location: location },
      body: JSON.stringify(item),
    };
  } catch (e: unknown) {
    console.error("CREATE object failed", e);
    const msg = e instanceof Error ? e.message : String(e);
    return errResp(msg);
  }
};

function canonicalBase(evt: any) {
  const domain = evt?.requestContext?.domainName ?? "";
  const stage  = evt?.requestContext?.stage;
  const proto  = evt?.headers?.["x-forwarded-proto"] ?? "https";
  const pathStage = !stage || stage === "$default" ? "" : `/${stage}`;
  return `${proto}://${domain}${pathStage}`;
}
