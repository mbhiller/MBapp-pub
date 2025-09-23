// apps/api/src/objects/delete.ts
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
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

    // Key format mirrors your GET code: pk=id, sk=tenant|type
    const Key = { pk: id, sk: `${tenantId}|${typeParam}` };

    // ReturnValues=ALL_OLD lets us tell if it existed
    const res = await ddb.send(
      new DeleteCommand({
        TableName: tableObjects,
        Key,
        ReturnValues: "ALL_OLD",
      })
    );

    if (!res.Attributes) {
      // nothing was deleted
      return notfound("object not found");
    }

    // keep DELETE responses consistent with other endpoints
    return ok({ id, type: typeParam, deleted: true });
  } catch (e) {
    return errResp(e);
  }
};
