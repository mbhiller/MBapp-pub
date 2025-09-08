import { bad, error as errResp } from "../common/responses";
import { getTenantId } from "../common/env";

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");
    const tag = evt?.queryStringParameters?.tag as string | undefined;
    if (!tag) return bad("tag query param is required");

    return {
      statusCode: 501,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "NotImplemented", message: "searchByTag pending", tag })
    };
  } catch (err: any) {
    return errResp(err);
  }
};
