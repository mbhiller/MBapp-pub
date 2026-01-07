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
      errorMap: {
        duplicate_ids: "duplicate_rv_sites",
        resource_not_found: "rv_site_not_found",
        invalid_resource_type: "invalid_rv_site_type",
        invalid_resources: "invalid_rv_sites",
      },
    });
  } catch (err: any) {
    // Remap messages for RV-site-specific wording (codes already mapped in common helper)
    if (err?.code === "rv_site_not_found") {
      throw Object.assign(new Error(err.message.replace("Resource", "RV site")), {
        code: err.code,
        statusCode: err.statusCode ?? 404,
      });
    }
    if (err?.code === "duplicate_rv_sites") {
      throw Object.assign(new Error("Duplicate RV site IDs"), {
        code: err.code,
        statusCode: err.statusCode ?? 400,
      });
    }
    if (err?.code === "invalid_rv_sites") {
      throw Object.assign(new Error("No RV site IDs provided"), {
        code: err.code,
        statusCode: err.statusCode ?? 400,
      });
    }
    throw err;
  }
}
