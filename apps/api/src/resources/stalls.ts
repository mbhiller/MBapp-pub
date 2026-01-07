// apps/api/src/resources/stalls.ts
/**
 * Stall resource helpers for Sprint BK.
 * Uses existing Resource type (type=resource, resourceType=stall).
 * Event association stored in resource.tags as "event:<eventId>".
 * Optional grouping stored as "group:<groupId>" (e.g., barn, row).
 */

import { assertResourcesExistAndAvailable } from "../common/resources";

export type AssertStallResourcesArgs = {
  tenantId?: string;
  stallIds: string[];
  eventId?: string;
};

/**
 * Validate that all stallIds exist, are resources of type stall, and optionally belong to eventId.
 * Wrapper around generalized assertResourcesExistAndAvailable for backward compatibility.
 */
export async function assertStallResourcesExistAndAvailable({
  tenantId,
  stallIds,
  eventId,
}: AssertStallResourcesArgs): Promise<Record<string, any>[]> {
  try {
    return await assertResourcesExistAndAvailable({
      tenantId,
      resourceIds: stallIds,
      eventId,
      expectedResourceType: "stall",
    });
  } catch (err: any) {
    // Remap generic error codes to stall-specific for backward compatibility
    if (err?.code === "resource_not_found") {
      throw Object.assign(new Error(err.message.replace("Resource", "Stall")), {
        code: "stall_not_found",
        statusCode: 404,
      });
    }
    if (err?.code === "invalid_resource_type") {
      throw Object.assign(new Error(err.message), {
        code: "invalid_stall_type",
        statusCode: 400,
      });
    }
    if (err?.code === "duplicate_ids") {
      throw Object.assign(new Error("Duplicate stall IDs"), {
        code: "duplicate_stalls",
        statusCode: 400,
      });
    }
    if (err?.code === "invalid_resources") {
      throw Object.assign(new Error("No stall IDs provided"), {
        code: "invalid_stalls",
        statusCode: 400,
      });
    }
    throw err;
  }
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
