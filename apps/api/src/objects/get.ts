// apps/api/src/objects/get.ts
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, notfound, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

/**
 * GET /objects/{type}/{id}
 * - Returns the full item by default.
 * - Optional projection: ?fields=a,b,c (aliases reserved names safely).
 */
export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const typeParam = (evt?.pathParameters?.type as string | undefined)?.trim();
    const id = (evt?.pathParameters?.id as string | undefined)?.trim();
    if (!typeParam) return bad("type is required");
    if (!id) return bad("id is required");

    // Optional projection
    const fieldsParam = (evt?.queryStringParameters?.fields as string | undefined)?.trim();
    let ProjectionExpression: string | undefined;
    let ExpressionAttributeNames: Record<string, string> | undefined;

    if (fieldsParam) {
      const raw = fieldsParam.split(",").map(s => s.trim()).filter(Boolean);
      if (raw.length) {
        const base = new Set(["pk","sk","id","type","tenantId","createdAt","updatedAt"]);
        raw.forEach(f => base.add(f));
        const names: Record<string,string> = {};
        const parts: string[] = [];
        for (const f of base) {
          const key = `#${f.replace(/[^A-Za-z0-9_]/g, "_")}`;
          names[key] = f;
          parts.push(key);
        }
        ExpressionAttributeNames = names;
        ProjectionExpression = parts.join(", ");
      }
    }

    const res = await ddb.send(new GetCommand({
      TableName: tableObjects,
      Key: { pk: id, sk: `${tenantId}|${typeParam}` },
      // Only include these if we actually built a projection:
      ...(ProjectionExpression ? { ProjectionExpression } : {}),
      ...(ExpressionAttributeNames ? { ExpressionAttributeNames } : {}),
    }));

    const item = res.Item as any;
    if (!item) return notfound("object not found");
    if (item?.tenantId !== tenantId || item?.type !== typeParam) return notfound("object not found");

    return ok(item);
  } catch (e: any) {
    return errResp(e);
  }
};
