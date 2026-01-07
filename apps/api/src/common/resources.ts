/**
 * Generalized resource validation helper (Sprint BM).
 * Used by discrete resource assignment endpoints (stalls, RV sites, etc.).
 */

import { getObjectById } from "../objects/repo";

export type AssertResourcesArgs = {
  tenantId?: string;
  resourceIds: string[];
  eventId?: string;
  expectedResourceType: string; // e.g., "stall", "rv"
  eventTagPrefix?: string;
};

/**
 * Validate that all resourceIds exist, are resources of expected type, and optionally belong to eventId.
 * @param tenantId - Tenant ID for object lookup
 * @param resourceIds - Array of resource IDs to validate
 * @param expectedResourceType - Expected resourceType value (e.g., "stall", "rv")
 * @param eventId - Optional event ID; if provided, validates that each resource has tag "event:<eventId>"
 * @param eventTagPrefix - Tag prefix for event membership (default "event:")
 * @throws Error with status 400 if validation fails (type mismatch, duplicate, etc.)
 * @throws Error with status 404 if any resource not found
 * @returns Array of validated resource objects
 */
export async function assertResourcesExistAndAvailable({
  tenantId,
  resourceIds,
  eventId,
  expectedResourceType,
  eventTagPrefix = "event:",
}: AssertResourcesArgs): Promise<Record<string, any>[]> {
  if (!resourceIds || resourceIds.length === 0) {
    throw Object.assign(new Error("No resource IDs provided"), { code: "invalid_resources", statusCode: 400 });
  }

  // Check for duplicates
  const unique = new Set(resourceIds);
  if (unique.size !== resourceIds.length) {
    throw Object.assign(new Error("Duplicate resource IDs"), { code: "duplicate_ids", statusCode: 400 });
  }

  const resources: Record<string, any>[] = [];

  for (const resourceId of resourceIds) {
    let resource: Record<string, any> | null = null;

    try {
      resource = await getObjectById({
        tenantId,
        type: "resource",
        id: resourceId,
        fields: ["id", "type", "resourceType", "tags", "status"],
      });
    } catch (err: any) {
      // Rethrow with 404 if not found
      if (err?.statusCode === 404 || err?.code === "not_found") {
        throw Object.assign(new Error(`Resource ${resourceId} not found`), {
          code: "resource_not_found",
          statusCode: 404,
        });
      }
      throw err;
    }

    if (!resource) {
      throw Object.assign(new Error(`Resource ${resourceId} not found`), {
        code: "resource_not_found",
        statusCode: 404,
      });
    }

    // Validate type and resourceType
    if (resource.type !== "resource") {
      throw Object.assign(new Error(`${resourceId} is not a resource`), {
        code: "invalid_resource_type",
        statusCode: 400,
      });
    }

    if (resource.resourceType !== expectedResourceType) {
      throw Object.assign(
        new Error(`${resourceId} is not a ${expectedResourceType} resource (got ${resource.resourceType})`),
        {
          code: "invalid_resource_type",
          statusCode: 400,
        }
      );
    }

    // Validate event membership if eventId provided
    if (eventId) {
      const tags = (resource.tags as string[]) ?? [];
      const eventTag = `${eventTagPrefix}${eventId}`;
      if (!tags.includes(eventTag)) {
        throw Object.assign(new Error(`Resource ${resourceId} does not belong to event ${eventId}`), {
          code: "resource_not_for_event",
          statusCode: 400,
        });
      }
    }

    resources.push(resource);
  }

  return resources;
}
