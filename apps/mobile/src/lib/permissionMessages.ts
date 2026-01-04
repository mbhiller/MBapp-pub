/**
 * Helper functions for generating permission-related error messages.
 * Centralizes permission message formatting to prevent hardcoded strings.
 */

/**
 * Generates a mobile-friendly "access denied" message for a missing permission.
 * @param requiredPerm - The permission constant (e.g., PERM_VIEW_WRITE)
 * @returns A formatted error message string
 */
export function permissionDeniedMessage(requiredPerm: string): string {
  return `Access denied — required: ${requiredPerm}`;
}
