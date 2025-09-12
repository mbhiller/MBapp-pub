import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, notfound, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const id = (evt?.pathParameters?.id as string | undefined)?.trim();
    const typeParam = (evt?.pathParameters?.type as string | undefined)?.trim();
    if (!id) return bad("id is required");
    if (!typeParam) return bad("type is required");

    const res = await ddb.send(new GetCommand({
      TableName: tableObjects,
      Key: { pk: id, sk: `${tenantId}|${typeParam}` },
    }));

    const it = res.Item as any;
    if (!it) return notfound("object not found");

    // Back-compat: if someone incorrectly saved kind into 'type', surface it
    const kindFromType = it.type === "good" || it.type === "service" ? it.type : undefined;
    const kind = it.kind ?? kindFromType;

    const out = {
      id: it.id,
      tenant: it.tenant,
      type: typeParam,       // normalize response type
      name: it.name,
      sku: it.sku,
      price: it.price,
      uom: it.uom,
      taxCode: it.taxCode,
      kind,                  // always present when provided
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    };
    return ok(out);
  } catch (e: any) {
    return errResp(e);
  }
};
