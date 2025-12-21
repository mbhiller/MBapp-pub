/**
 * Shared pagination utilities for list endpoints.
 * Sprint IV - standardized across /views, /workspaces, /registrations
 */

export interface ListPage<T = any> {
  items: T[];
  next: string | null;
}

/**
 * Build a standardized list page response.
 * @param items - Array of items for current page
 * @param next - Opaque cursor for next page (null if no more pages)
 * @returns Standardized list response shape
 */
export function buildListPage<T = any>(items: T[], next: string | null = null): ListPage<T> {
  return { items, next };
}

/**
 * Parse pagination parameters from query string.
 * @param qsp - Query string parameters object
 * @param defaultLimit - Default page size (default: 25)
 * @returns Parsed limit and cursor
 */
export function parsePagination(qsp: Record<string, any> = {}, defaultLimit = 25) {
  const limit = Number(qsp.limit ?? defaultLimit);
  const cursor = qsp.next ?? qsp.cursor ?? undefined;
  return { limit, cursor };
}
