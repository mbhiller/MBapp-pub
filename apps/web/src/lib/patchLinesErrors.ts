/**
 * Shared error handling for patch-lines API responses.
 * Standardizes 409 (not editable) detection and messaging across web and mobile.
 */

export type PatchLinesErrorContext = "SO" | "PO";

/**
 * Check if error is a 409 "not editable in status" error.
 * Handles various error shapes from web and mobile API layers.
 */
export function isPatchLinesStatusGuardError(err: unknown): boolean {
  const e = err as any;
  const httpStatus = e?.status || e?.body?.status || e?.response?.status;
  const code = e?.code || e?.body?.code;
  
  // 409 Conflict = not editable in current status
  if (httpStatus === 409) return true;
  
  // Explicit code indicators
  if (code === "PO_NOT_EDITABLE" || code === "SO_NOT_EDITABLE") return true;
  
  // 400 with explicit guard code
  if (httpStatus === 400 && (code === "PO_NOT_EDITABLE" || code === "SO_NOT_EDITABLE")) return true;
  
  return false;
}

/**
 * Get user-friendly error message for patch-lines operation.
 * 409/status guard errors show specific restriction message.
 * Returns: { message: string, isStatusGuardError: boolean }
 */
export function getPatchLinesErrorMessage(
  err: unknown,
  context: PatchLinesErrorContext
): { message: string; isStatusGuardError: boolean } {
  const e = err as any;
  const isGuard = isPatchLinesStatusGuardError(err);
  
  if (isGuard) {
    // Status guard (409) error
    if (context === "PO") {
      return {
        message: "Purchase order is not editable in this status (only Draft can be modified).",
        isStatusGuardError: true,
      };
    } else {
      return {
        message: "Sales order is not editable in this status.",
        isStatusGuardError: true,
      };
    }
  }
  
  // Generic error message
  const customMsg = e?.message || e?.body?.message;
  if (customMsg) {
    return { message: customMsg, isStatusGuardError: false };
  }
  
  return {
    message: `Failed to update ${context === "PO" ? "purchase" : "sales"} order`,
    isStatusGuardError: false,
  };
}

/**
 * Format error for web display (simple text).
 * Called from EditSalesOrderPage, EditPurchaseOrderPage.
 */
export function formatPatchLinesError(err: unknown, context: PatchLinesErrorContext): string {
  const { message } = getPatchLinesErrorMessage(err, context);
  return message;
}

/**
 * Extract HTTP status code from various error shapes.
 */
export function getErrorStatus(err: unknown): number | undefined {
  const e = err as any;
  return e?.status || e?.body?.status || e?.response?.status;
}
