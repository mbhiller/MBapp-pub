// src/objects/get.ts
import { ok, notfound, bad, error as errResp, redirect308 } from "../common/responses";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, notfound, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    const qs = evt?.queryStringParameters ?? {};
    const pp = evt?.pathParameters ?? {};
    const id = pp.id ?? qs.id;
    if (!id) return bad("id is required");

    const typeInPath = pp.type as string | undefined;
    const typeInQuery = qs.type as string | undefined;

    // Normalize to canonical: /objects/{type}/{id}
    if (!typeInPath) {
      const base = canonicalBase(evt);
      if (typeInQuery) {
        return redirect308(`${base}/objects/${encodeURIComponent(typeInQuery)}/${encodeURIComponent(id)}`);
      }
      const inferred = await inferTypeById(tenantId, id);
      if (inferred) {
        return redirect308(`${base}/objects/${encodeURIComponent(inferred)}/${encodeURIComponent(id)}`);
      }
      return bad("type is required (or enable BY_ID_INDEX to infer it)");
    }

    // Canonical GET
    const type = typeInPath;
    const pk = `TENANT#${tenantId}#TYPE#${type}`;
    const sk = `ID#${id}`;

    const { Item } = await ddb.send(
      new GetCommand({ TableName: tableObjects, Key: { pk, sk } })
    );
    if (!Item) return notfound(`Object not found: ${type}/${id}`);
    return ok(Item);
  } catch (e) {
    console.error("GET object failed", e);
    return errResp("Internal error");
  }
};

// --- helpers ---
function canonicalBase(evt: any) {
  const domain = evt?.requestContext?.domainName ?? "";
  const stage = evt?.requestContext?.stage;
  const pathStage = !stage || stage === "$default" ? "" : `/${stage}`;
  const proto = evt?.headers?.["x-forwarded-proto"] ?? "https";
  return `${proto}://${domain}${pathStage}`;
}

function redirect308(location: string) {
  return { statusCode: 308, headers: { Location: location } };
}

async function inferTypeById(tenantId: string, id: string): Promise<string | undefined> {
  const indexName = process.env.BY_ID_INDEX; // set to "byId" if using inference
  if (!indexName) return undefined;

  // Try GSI A: HASH=id, RANGE=tenantId
  try {
    const r = await ddb.send(new QueryCommand({
      TableName: tableObjects,
      IndexName: indexName,
      KeyConditionExpression: "#id = :id and #t = :t",
      ExpressionAttributeNames: { "#id": "id", "#t": "tenantId" },
      ExpressionAttributeValues: { ":id": id, ":t": tenantId },
      Limit: 1
    }));
    const hit = r.Items?.[0];
    if (hit?.type) return String(hit.type);
  } catch {}

  // Try GSI B: HASH=id_tenant
  try {
    const r2 = await ddb.send(new QueryCommand({
      TableName: tableObjects,
      IndexName: indexName,
      KeyConditionExpression: "#idt = :idt",
      ExpressionAttributeNames: { "#idt": "id_tenant" },
      ExpressionAttributeValues: { ":idt": `${id}#${tenantId}` },
      Limit: 1
    }));
    const hit2 = r2.Items?.[0];
    if (hit2?.type) return String(hit2.type);
  } catch {}

  return undefined;
}
