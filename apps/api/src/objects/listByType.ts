import { bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");
    const typeParam = evt?.pathParameters?.type as string | undefined;
    if (!typeParam) return bad("type is required");

    const limit = Math.min(parseInt(evt?.queryStringParameters?.limit ?? "25"), 100);
    return {
      statusCode: 501,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "NotImplemented", message: "listByType pending", type: typeParam, limit })
    };
  } catch (err: any) {
    return errResp(err);
  }
};
