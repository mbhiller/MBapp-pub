// apps/api/src/common/party.ts
import { getObjectById, updateObject } from "../objects/repo";

export type PartyRole = "customer" | "vendor";
type Party = {
  id: string;
  roleFlags?: Record<string, boolean>;
  roles?: string[];
  // ...other fields allowed
  [k: string]: any;
};

/**
 * Strong read via repo helper (which knows your PK/SK layout).
 */
export async function getParty(tenantId: string, id: string): Promise<Party | null> {
  const p = (await getObjectById({ tenantId, type: "party", id })) as Party | null;
  return (p && typeof p === "object") ? p : null;
}

/**
 * Keep Party.roleFlags in sync (and optionally roles[] for UI).
 * Uses updateObject so we don't touch raw PK/SK.
 */
export async function markPartyRole(opts: {
  tenantId: string;
  partyId: string;
  role: PartyRole | string;
  active: boolean;
  maintainRolesArray?: boolean; // default true
}) {
  const { tenantId, partyId, role, active, maintainRolesArray = true } = opts;

  const current = (await getParty(tenantId, partyId)) as Party | null;
  if (!current) return;

  // Make TS happy: explicitly type the maps/arrays we manipulate
  const flags: Record<string, boolean> = { ...(current.roleFlags ?? {}) };
  let roles: string[] = Array.isArray(current.roles) ? [...current.roles] : [];

  if (active) {
    flags[role] = true;
    if (maintainRolesArray && !roles.includes(role)) roles = [...roles, role];
  } else {
    delete flags[role];
    // minimal overhead: we don't prune roles[] on deactivate
  }

  await updateObject({
    tenantId,
    type: "party",
    id: partyId,
    body: {
      roleFlags: flags,
      ...(maintainRolesArray ? { roles } : {}),
    },
  });
}
