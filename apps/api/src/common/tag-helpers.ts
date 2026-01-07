/**
 * Tag parsing utilities (Sprint BN).
 * Consolidates tag extraction logic for resource scoping (events, groups, etc).
 */

/**
 * Extract a value from resource tags by prefix.
 * Looks for tag "{prefix}:{value}" and returns the value or null.
 *
 * @param tags - Array of tag strings (or undefined)
 * @param prefix - Tag prefix to search for (e.g., "event", "group", "lot")
 * @returns The extracted value, or null if not found
 */
export function extractTagValue(tags: string[] | undefined, prefix: string): string | null {
  if (!tags || !Array.isArray(tags)) return null;
  const tagPrefix = `${prefix}:`;
  for (const tag of tags) {
    if (tag.startsWith(tagPrefix)) {
      return tag.substring(tagPrefix.length);
    }
  }
  return null;
}

/**
 * Extract event ID from resource tags.
 * Looks for tag "event:<eventId>" and returns eventId or null.
 *
 * @param tags - Array of tag strings (or undefined)
 * @returns The event ID, or null if not found
 */
export function extractEventIdFromTags(tags: string[] | undefined): string | null {
  return extractTagValue(tags, "event");
}

/**
 * Extract group ID from resource tags.
 * Looks for tag "group:<groupId>" and returns groupId or null.
 * Group ID typically refers to a barn, lot, section, or other logical grouping.
 *
 * @param tags - Array of tag strings (or undefined)
 * @returns The group ID, or null if not found
 */
export function extractGroupIdFromTags(tags: string[] | undefined): string | null {
  return extractTagValue(tags, "group");
}
