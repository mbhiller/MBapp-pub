// apps/api/src/resources/stalls.ts
/**
 * Stall resource helpers for Sprint BK.
 * Uses existing Resource type (type=resource, resourceType=stall).
 * Event association stored in resource.tags as "event:<eventId>".
 * Optional grouping stored as "group:<groupId>" (e.g., barn, row).
 */

import { assertResourcesExistAndAvailable } from "../common/resources";
import { extractEventIdFromTags, extractGroupIdFromTags } from "../common/tag-helpers";

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
      errorMap: {
        duplicate_ids: "duplicate_stalls",
        resource_not_found: "stall_not_found",
        invalid_resource_type: "invalid_stall_type",
        invalid_resources: "invalid_stalls",
      },
    });
  } catch (err: any) {
    // Remap messages for stall-specific wording (codes already mapped in common helper)
    if (err?.code === "stall_not_found") {
      throw Object.assign(new Error(err.message.replace("Resource", "Stall")), {
        code: err.code,
        statusCode: err.statusCode ?? 404,
      });
    }
    if (err?.code === "duplicate_stalls") {
      throw Object.assign(new Error("Duplicate stall IDs"), {
        code: err.code,
        statusCode: err.statusCode ?? 400,
      });
    }
    if (err?.code === "invalid_stalls") {
      throw Object.assign(new Error("No stall IDs provided"), {
        code: err.code,
        statusCode: err.statusCode ?? 400,
      });
    }
    throw err;
  }
}
