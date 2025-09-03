import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, notfound, bad } from "../common/responses";
import { getTenantId } from "../common/env";

// Small helpers (scoped, no top-level evt usage)
const normHeaders = (h: Record<string, string> | null | undefined = {}) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h || {})) out[k.toLowerCase()] = String(v);
  return out;
};
const qsGet = (qs: Record<string, string> | null | undefined, k: string) =>
  qs?.[k] ?? qs?.[k.toLowerCase()] ?? qs?.[k.toUpperCase()];

export const handler = async (evt: any) => {
  // Tenant (prefer your existing helper; fallback to normalized header)
  const headers = normHeaders(evt?.headers);
  const tenantId = getTenantId(evt) || headers["x-tenant-id"];
  if (!tenantId) return bad("X-Tenant-Id header required");

  // ID can be in the path or query
  const qs = evt?.queryStringParameters ?? {};
  const idFromPath = evt?.pathParameters?.id ?? evt?.rawPath?.split("/")?.[2]; // supports /objects/{id}
  const id = idFromPath ?? qsGet(qs, "id");
  if (!id) return bad("id path or query param is required");

  // Require type (so we can compose the SK without scanning)
  const type = qsGet(qs, "type");
  if (!type) return bad("type query param is required");

  // Debug (optional)
  console.log(JSON.stringify({
    routeKey: evt?.requestContext?.routeKey,
    path: evt?.requestContext?.http?.path,
    id, type, tenantId,
    pathParameters: evt?.pathParameters,
    qs: evt?.queryStringParameters
  }));

  const sk = `obj#${type}#${id}`;

  const res = await ddb.send(new GetCommand({
    TableName: tableObjects,
    Key: { pk: `tenant#${tenantId}`, sk },
  }));

  if (!res.Item) return notfound();
  return ok(res.Item);
};
