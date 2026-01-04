/**
 * Helper functions for generating permission-related error messages.
 * Centralizes permission message formatting to prevent hardcoded strings.
 */

/**
 * Generates a friendly "access denied" message for a missing permission.
 * @param requiredPerm - The permission constant (e.g., PERM_VIEW_WRITE, PERM_WORKSPACE_WRITE)
 * @returns A formatted error message string
 */
export function permissionDeniedMessage(requiredPerm: string): string {
  return `Access denied — You lack permission to perform this action. Required: ${requiredPerm}`;
}

/**
 * Generates a tooltip message indicating that a feature requires a specific permission.
 * @param requiredPerm - The permission constant (e.g., PERM_VIEW_WRITE, PERM_WORKSPACE_WRITE)
 * @returns A formatted tooltip string
 */
export function permissionRequiredTooltip(requiredPerm: string): string {
  return `Requires ${requiredPerm} permission`;
}
