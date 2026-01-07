// apps/api/src/resources/rv-sites.ts
/**
 * RV site resource helpers for Sprint BL.
 * Uses existing Resource type (type=resource, resourceType=rv).
 * Event association stored in resource.tags as "event:<eventId>".
 * Optional grouping stored as "group:<groupId>" (e.g., lot, section).
 */

import { getObjectById } from "../objects/repo";

export type AssertRvResourcesArgs = {
  tenantId?: string;
  rvSiteIds: string[];
  eventId?: string;
};

/**
 * Validate that all rvSiteIds exist, are resources of type rv, and optionally belong to eventId.
 * @param tenantId - Tenant ID for object lookup
 * @param rvSiteIds - Array of resource IDs to validate
 * @param eventId - Optional event ID; if provided, validates that each resource has tag "event:<eventId>"
 * @throws Error with status 400 if validation fails (type, resourceType, or event mismatch)
 * @throws Error with status 404 if any RV site not found
 * @returns Array of validated resource objects
 */
export async function assertRvResourcesExistAndAvailable({
  tenantId,
  rvSiteIds,
  eventId,
}: AssertRvResourcesArgs): Promise<Record<string, any>[]> {
  if (!rvSiteIds || rvSiteIds.length === 0) {
    throw Object.assign(new Error("No RV site IDs provided"), { code: "invalid_rv_sites", statusCode: 400 });
  }

  // Check for duplicates
  const unique = new Set(rvSiteIds);
  if (unique.size !== rvSiteIds.length) {
    throw Object.assign(new Error("Duplicate RV site IDs"), { code: "duplicate_rv_sites", statusCode: 400 });
  }

  const resources: Record<string, any>[] = [];

  for (const rvSiteId of rvSiteIds) {
    let resource: Record<string, any> | null = null;

    try {
      resource = await getObjectById({
        tenantId,
        type: "resource",
        id: rvSiteId,
        fields: ["id", "type", "resourceType", "tags", "status"],
      });
    } catch (err: any) {
      // Rethrow with 404 if not found
      if (err?.statusCode === 404 || err?.code === "not_found") {
        throw Object.assign(new Error(`RV site ${rvSiteId} not found`), {
          code: "rv_site_not_found",
          statusCode: 404,
        });
      }
      throw err;
    }

    if (!resource) {
      throw Object.assign(new Error(`RV site ${rvSiteId} not found`), { code: "rv_site_not_found", statusCode: 404 });
    }

    // Validate type and resourceType
    if (resource.type !== "resource") {
      throw Object.assign(new Error(`${rvSiteId} is not a resource`), {
        code: "invalid_rv_site_type",
        statusCode: 400,
      });
    }

    if (resource.resourceType !== "rv") {
      throw Object.assign(new Error(`${rvSiteId} is not an RV site`), {
        code: "invalid_rv_site_type",
        statusCode: 400,
      });
    }

    // Validate event membership if eventId provided
    if (eventId) {
      const tags = (resource.tags as string[]) ?? [];
      const eventTag = `event:${eventId}`;
      if (!tags.includes(eventTag)) {
        throw Object.assign(
          new Error(`RV site ${rvSiteId} does not belong to event ${eventId}`),
          {
            code: "rv_site_not_for_event",
            statusCode: 400,
          }
        );
      }
    }

    resources.push(resource);
  }

  return resources;
}
