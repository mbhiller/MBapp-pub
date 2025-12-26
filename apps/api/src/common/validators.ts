// apps/api/src/common/validators.ts
import { getObjectById } from "../objects/repo";
import type { PartyRole } from "./party";

type Party = {
  id: string;
  roles?: string[];
  roleFlags?: Record<string, boolean>;
  [k: string]: any;
};

/** Fast gate: strong read via repo → check Party.roles[] only. */
export async function ensurePartyRole(args: {
  tenantId: string;
  partyId: string;
  role: PartyRole; // "customer" | "vendor"
}) {
  const { tenantId, partyId, role } = args;
  if (!tenantId) throw Object.assign(new Error("missing_tenant"), { statusCode: 400 });
  if (!partyId)  throw Object.assign(new Error("missing_partyId"), { statusCode: 400 });

  const party = (await getObjectById({ tenantId, type: "party", id: partyId })) as Party | null;
  const roles = Array.isArray(party?.roles) ? party!.roles!.map(r => String(r).toLowerCase()) : [];
  const required = String(role).toLowerCase();
  const ok = roles.includes(required);
  if (!ok) {
    const err: any = new Error(`party_missing_required_role:${role}`);
    err.statusCode = 400;
    err.details = { code: "PARTY_ROLE_MISSING", partyId, requiredRole: role, roles: party?.roles ?? null };
    throw err;
  }
  return true;
}
