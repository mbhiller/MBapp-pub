/**
 * Registration request validation helpers (Sprint BN).
 * Consolidates common validation logic for resource/stall/rv-site assignment handlers.
 */

/**
 * Validates that a value is a non-empty array of non-empty strings.
 * Used for resourceIds, stallIds, rvSiteIds validation.
 *
 * @param value - The value to validate (typically from request body)
 * @param opts - Options including field name and custom error codes
 * @returns The validated array of strings (trimmed)
 * @throws Object with code, statusCode, and message for use with badRequest()
 */
export function parseNonEmptyStringArray(
  value: unknown,
  opts: {
    field: string;
    codeEmpty?: string;
    codeInvalid?: string;
    codeDuplicate?: string;
    label?: string;
  }
): string[] {
  const {
    field,
    codeEmpty = "invalid_resource_ids",
    codeInvalid = "invalid_resource_ids",
    codeDuplicate = "duplicate_ids",
    label = field,
  } = opts;

  // Check if it's an array
  if (!Array.isArray(value)) {
    throw Object.assign(
      new Error(`${label} must be a non-empty array`),
      { code: codeInvalid, statusCode: 400, field }
    );
  }

  // Check if non-empty
  if (value.length === 0) {
    throw Object.assign(new Error(`${label} must be a non-empty array`), {
      code: codeEmpty,
      statusCode: 400,
      field,
    });
  }

  // Check if all items are strings
  if (!value.every((id: unknown) => typeof id === "string")) {
    throw Object.assign(new Error(`${label} must contain only strings`), {
      code: codeInvalid,
      statusCode: 400,
      field,
    });
  }

  // Check for duplicates
  const unique = new Set(value);
  if (unique.size !== value.length) {
    throw Object.assign(new Error(`Duplicate entries in ${label}`), {
      code: codeDuplicate,
      statusCode: 400,
      field,
    });
  }

  return value;
}
