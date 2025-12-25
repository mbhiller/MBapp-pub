// apps/web/src/lib/locations.ts
// Minimal locations list helper using apiFetch

import { apiFetch } from "./http";

export type Location = {
  id?: string | number;
  name?: string;
  label?: string;
  displayName?: string;
  [key: string]: unknown;
};

export type LocationListResponse = {
  items?: Location[];
  next?: string;
};

/**
 * List locations with optional pagination.
 * Endpoint: GET /objects/location
 * Follows web list pattern: query { limit, next, sort: "desc" }
 */
export async function listLocations(
  args: { limit?: number; next?: string } = {},
  opts: { token?: string; tenantId: string }
): Promise<LocationListResponse> {
  const { limit = 50, next } = args;
  return apiFetch<LocationListResponse>("/objects/location", {
    token: opts.token,
    tenantId: opts.tenantId,
    query: { limit, next, sort: "desc" },
  });
}
