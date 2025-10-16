// apps/api/src/common/validators.ts
import { getObjectById } from "../objects/repo";
import type { PartyRole } from "./party";

type Party = {
  id: string;
  roleFlags?: Record<string, boolean>;
  [k: string]: any;
};

/** Fast gate: one strong read through repo → check Party.roleFlags. */
export async function ensurePartyRole(args: {
  tenantId: string;
  partyId: string;
  role: PartyRole; // "customer" | "vendor"
}) {
  const { tenantId, partyId, role } = args;
  if (!tenantId) throw Object.assign(new Error("missing_tenant"), { statusCode: 400 });
  if (!partyId)  throw Object.assign(new Error("missing_partyId"), { statusCode: 400 });

  const party = (await getObjectById({ tenantId, type: "party", id: partyId })) as Party | null;
  const flags: Record<string, boolean> | undefined = party?.roleFlags;

  const ok = !!(flags && flags[role] === true);
  if (!ok) throw Object.assign(new Error(`party_missing_required_role:${role}`), { statusCode: 400 });
  return true;
}
