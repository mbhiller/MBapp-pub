// apps/api/src/resources/rv-sites.ts
/**
 * RV site resource helpers for Sprint BL.
 * Uses existing Resource type (type=resource, resourceType=rv).
 * Event association stored in resource.tags as "event:<eventId>".
 * Optional grouping stored as "group:<groupId>" (e.g., lot, section).
 */

import { assertResourcesExistAndAvailable } from "../common/resources";

export type AssertRvResourcesArgs = {
  tenantId?: string;
  rvSiteIds: string[];
  eventId?: string;
};

/**
 * Validate that all rvSiteIds exist, are resources of type rv, and optionally belong to eventId.
 * Wrapper around generalized assertResourcesExistAndAvailable for backward compatibility.
 */
export async function assertRvResourcesExistAndAvailable({
  tenantId,
  rvSiteIds,
  eventId,
}: AssertRvResourcesArgs): Promise<Record<string, any>[]> {
  try {
    return await assertResourcesExistAndAvailable({
      tenantId,
      resourceIds: rvSiteIds,
      eventId,
      expectedResourceType: "rv",
    });
  } catch (err: any) {
    // Remap generic error codes to rv-site-specific for backward compatibility
    if (err?.code === "resource_not_found") {
      throw Object.assign(new Error(err.message.replace("Resource", "RV site")), {
        code: "rv_site_not_found",
        statusCode: 404,
      });
    }
    if (err?.code === "invalid_resource_type") {
      throw Object.assign(new Error(err.message), {
        code: "invalid_rv_site_type",
        statusCode: 400,
      });
    }
    if (err?.code === "duplicate_ids") {
      throw Object.assign(new Error("Duplicate RV site IDs"), {
        code: "duplicate_rv_sites",
        statusCode: 400,
      });
    }
    if (err?.code === "invalid_resources") {
      throw Object.assign(new Error("No RV site IDs provided"), {
        code: "invalid_rv_sites",
        statusCode: 400,
      });
    }
    throw err;
  }
}
