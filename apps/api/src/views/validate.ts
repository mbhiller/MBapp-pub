/**
 * Minimal validation for View filters.
 * Prevents obviously-invalid filters from being persisted.
 */

type ViewFilter = {
  field?: unknown;
  op?: unknown;
  value?: unknown;
};

// Allowed operators per spec
const ALLOWED_OPS = new Set([
  "eq",
  "ne",
  "lt",
  "le",
  "gt",
  "ge",
  "in",
  "nin",
  "contains",
  "startsWith",
  "regex",
]);

/**
 * Validates a single ViewFilter object.
 * Returns error message if invalid, undefined if valid.
 */
export function validateFilter(filter: ViewFilter): string | undefined {
  if (!filter || typeof filter !== "object") {
    return "Filter must be an object";
  }

  // Validate field
  if (typeof filter.field !== "string" || filter.field.trim().length === 0) {
    return "Invalid view filter: field must be a non-empty string";
  }

  // Validate operator
  if (!ALLOWED_OPS.has(filter.op as string)) {
    return `Invalid view filter: op must be one of ${Array.from(ALLOWED_OPS).join(", ")}`;
  }

  // Validate value shape based on operator
  const isArrayOp = filter.op === "in" || filter.op === "nin";

  if (isArrayOp) {
    // For "in" and "nin", value must be an array
    if (!Array.isArray(filter.value)) {
      return `Invalid view filter: "${filter.op}" operator requires an array value`;
    }
  } else {
    // For other operators, value must be string, number, or boolean (not an object/array)
    const valueType = typeof filter.value;
    if (
      valueType !== "string" &&
      valueType !== "number" &&
      valueType !== "boolean"
    ) {
      return `Invalid view filter: value must be a string, number, or boolean (got ${valueType})`;
    }
  }

  return undefined; // Valid
}

/**
 * Validates all filters in a view body.
 * Returns error message if any filter is invalid, undefined if all valid.
 */
export function validateFilters(filters: unknown): string | undefined {
  if (!filters) return undefined; // Filters are optional

  if (!Array.isArray(filters)) {
    return "Invalid view filter: filters must be an array";
  }

  for (let i = 0; i < filters.length; i++) {
    const filterError = validateFilter(filters[i]);
    if (filterError) {
      return `Filter #${i}: ${filterError}`;
    }
  }

  return undefined; // All valid
}
