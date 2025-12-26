// apps/mobile/src/features/parties/api.ts
// Generic objects client for Parties using /objects/party endpoints.
import { listObjects, getObject, createObject, apiClient } from "../../api/client";
import type { components } from "../../api/generated-types";

export type Party = components["schemas"]["Party"];

const TYPE = "party";

/**
 * Get a display-friendly label for a party.
 * Prefers displayName, then firstName/lastName, else falls back to id.
 */
export function partyLabel(p: Party): string {
  if (p.displayName) return p.displayName;
  const first = p.firstName || "";
  const last = p.lastName || "";
  const full = `${first} ${last}`.trim();
  if (full) return full;
  return p.id || "(unnamed)";
}

/**
 * List parties with optional search and client-side role filtering.
 * Returns a flat Party[] array (unwraps ListPage).
 */
export async function findParties(params: { q?: string; role?: string }): Promise<Party[]> {
  try {
    const page = await listObjects<Party>(TYPE, {
      limit: 100,
      sort: "desc",
      q: params.q || undefined,
      role: params.role || undefined,
    });
    let items = page.items || [];
    // Client-side role filtering (best-effort; roles field may not be present)
    if (params.role) {
      items = items.filter((p) => {
        const role = params?.role?.trim();
        if (role) {
          const roles = Array.isArray(p.roles) ? p.roles : [];
          const roleFlags = (p as any).roleFlags as Record<string, boolean> | undefined;
          return roleFlags?.[role] === true || roles.includes(role);
        }
        return true;
      });
    }
    return items;
  } catch (err) {
    console.error("findParties error:", err);
    throw err;
  }
}

/**
 * Get a single party by ID.
 */
export async function getParty(id: string): Promise<Party> {
  return getObject<Party>(TYPE, id);
}

/**
 * Create a new party.
 * Minimal required fields: kind, name.
 */
export async function createParty(input: {
  kind: "person" | "organization" | "animal";
  name: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  notes?: string;
}): Promise<Party> {
  return createObject<Party>(TYPE, {
    ...input,
    type: TYPE as any,
  });
}

/**
 * Add a role to a party by updating Party.roles[].
 * Returns the updated party object.
 */
export async function addPartyRole(
  partyId: string,
  role: "customer" | "vendor"
): Promise<Party> {
  // GET party, union roles, PUT updated party
  const party = await getObject<Party>(TYPE, partyId);
  const existingRoles = Array.isArray(party.roles) ? party.roles : [];
  const nextRoles = Array.from(new Set([...existingRoles, role]));
  const updated = await apiClient.put<Party>(`/objects/${TYPE}/${encodeURIComponent(partyId)}`, { roles: nextRoles });
  return updated;
}
