// apps/api/src/objects/get.ts
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, notfound, bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const qs = evt?.queryStringParameters ?? {};
    const pp = evt?.pathParameters ?? {};

    // Support BOTH:
    // A) /objects/{type}/{id}  (canonical)
    // B) /objects/{id}?type=horse
    const id = (pp as any)?.id ?? (qs as any)?.id;
    if (!id) return bad("id is required");

    const typeInPath  = (pp as any)?.type as string | undefined;
    const typeInQuery = (qs as any)?.type as string | undefined;

    // If type isn't in the path, redirect to the canonical path:
    if (!typeInPath) {
      const base = canonicalBase(evt);
      if (typeInQuery) {
        return redirect308(`${base}/objects/${encodeURIComponent(typeInQuery)}/${encodeURIComponent(id)}`);
      }
      // Optional inference if BY_ID_INDEX is configured on the table
      const inferred = await inferTypeById(tenantId, id);
      if (inferred) {
        return redirect308(`${base}/objects/${encodeURIComponent(inferred)}/${encodeURIComponent(id)}`);
      }
      return bad("type is required (or set BY_ID_INDEX and GSI to enable inference)");
    }

    // Canonical GET: /objects/{type}/{id}
    const type = typeInPath;
    const pk = `TENANT#${tenantId}#TYPE#${type}`;
    const sk = `ID#${id}`;

    const res = await ddb.send(new GetCommand({
      TableName: tableObjects,
      Key: { pk, sk },
      ConsistentRead: true
    }));

    if (!res.Item) return notfound(`Object not found: ${type}/${id}`);
    return ok(res.Item);
  } catch (e: unknown) {
    console.error("GET object failed", e);
    const msg = e instanceof Error ? e.message : String(e);
    return errResp(msg); // <-- pass a string to satisfy the helper’s signature
  }
};

// --- helpers ---
function canonicalBase(evt: any) {
  const domain = evt?.requestContext?.domainName ?? "";
  const stage  = evt?.requestContext?.stage;
  const pathStage = !stage || stage === "$default" ? "" : `/${stage}`;
  const proto  = (evt?.headers?.["x-forwarded-proto"] ?? evt?.headers?.["X-Forwarded-Proto"] ?? "https");
  return `${proto}://${domain}${pathStage}`;
}

function redirect308(location: string) {
  return { statusCode: 308, headers: { Location: location } };
}

async function inferTypeById(tenantId: string, id: string): Promise<string | undefined> {
  const indexName = process.env.BY_ID_INDEX; // e.g., "byId"
  if (!indexName) return undefined;

  // Variant A: HASH=id, RANGE=tenantId
  try {
    const r = await ddb.send(new QueryCommand({
      TableName: tableObjects,
      IndexName: indexName,
      KeyConditionExpression: "#id = :id AND #t = :t",
      ExpressionAttributeNames:  { "#id": "id", "#t": "tenantId" },
      ExpressionAttributeValues: { ":id": id,  ":t": tenantId  },
      Limit: 1
    }));
    const hit = r.Items?.[0];
    if (hit?.type) return String(hit.type);
  } catch {}

  // Variant B: HASH=id_tenant
  try {
    const r2 = await ddb.send(new QueryCommand({
      TableName: tableObjects,
      IndexName: indexName,
      KeyConditionExpression: "#idt = :idt",
      ExpressionAttributeNames:  { "#idt": "id_tenant" },
      ExpressionAttributeValues: { ":idt": `${id}#${tenantId}` },
      Limit: 1
    }));
    const hit2 = r2.Items?.[0];
    if (hit2?.type) return String(hit2.type);
  } catch {}

  return undefined;
}
