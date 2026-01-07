// apps/api/src/resources/stalls.ts
/**
 * Stall resource helpers for Sprint BK.
 * Uses existing Resource type (type=resource, resourceType=stall).
 * Event association stored in resource.tags as "event:<eventId>".
 * Optional grouping stored as "group:<groupId>" (e.g., barn, row).
 */

import { getObjectById } from "../objects/repo";

export type AssertStallResourcesArgs = {
  tenantId?: string;
  stallIds: string[];
  eventId?: string;
};

/**
 * Validate that all stallIds exist, are resources of type stall, and optionally belong to eventId.
 * @param tenantId - Tenant ID for object lookup
 * @param stallIds - Array of resource IDs to validate
 * @param eventId - Optional event ID; if provided, validates that each resource has tag "event:<eventId>"
 * @throws Error with status 400 if validation fails (type, resourceType, or event mismatch)
 * @throws Error with status 404 if any stall not found
 * @returns Array of validated resource objects
 */
export async function assertStallResourcesExistAndAvailable({
  tenantId,
  stallIds,
  eventId,
}: AssertStallResourcesArgs): Promise<Record<string, any>[]> {
  if (!stallIds || stallIds.length === 0) {
    throw Object.assign(new Error("No stall IDs provided"), { code: "invalid_stalls", statusCode: 400 });
  }

  // Check for duplicates
  const unique = new Set(stallIds);
  if (unique.size !== stallIds.length) {
    throw Object.assign(new Error("Duplicate stall IDs"), { code: "duplicate_stalls", statusCode: 400 });
  }

  const resources: Record<string, any>[] = [];

  for (const stallId of stallIds) {
    let resource: Record<string, any> | null = null;

    try {
      resource = await getObjectById({
        tenantId,
        type: "resource",
        id: stallId,
        fields: ["id", "type", "resourceType", "tags", "status"],
      });
    } catch (err: any) {
      // Rethrow with 404 if not found
      if (err?.statusCode === 404 || err?.code === "not_found") {
        throw Object.assign(new Error(`Stall ${stallId} not found`), {
          code: "stall_not_found",
          statusCode: 404,
        });
      }
      throw err;
    }

    if (!resource) {
      throw Object.assign(new Error(`Stall ${stallId} not found`), { code: "stall_not_found", statusCode: 404 });
    }

    // Validate type and resourceType
    if (resource.type !== "resource") {
      throw Object.assign(new Error(`${stallId} is not a resource`), {
        code: "invalid_stall_type",
        statusCode: 400,
      });
    }

    if (resource.resourceType !== "stall") {
      throw Object.assign(new Error(`${stallId} is not a stall`), {
        code: "invalid_stall_type",
        statusCode: 400,
      });
    }

    // Validate event membership if eventId provided
    if (eventId) {
      const tags = (resource.tags as string[]) ?? [];
      const eventTag = `event:${eventId}`;
      if (!tags.includes(eventTag)) {
        throw Object.assign(
          new Error(`Stall ${stallId} does not belong to event ${eventId}`),
          {
            code: "stall_not_for_event",
            statusCode: 400,
          }
        );
      }
    }

    resources.push(resource);
  }

  return resources;
}

/**
 * Extract group ID from resource tags.
 * Looks for tag "group:<groupId>" and returns groupId or null.
 */
export function extractGroupIdFromTags(tags: string[] | undefined): string | null {
  if (!tags || !Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (tag.startsWith("group:")) {
      return tag.substring(6); // "group:".length = 6
    }
  }
  return null;
}

/**
 * Extract event ID from resource tags.
 * Looks for tag "event:<eventId>" and returns eventId or null.
 */
export function extractEventIdFromTags(tags: string[] | undefined): string | null {
  if (!tags || !Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (tag.startsWith("event:")) {
      return tag.substring(6); // "event:".length = 6
    }
  }
  return null;
}
