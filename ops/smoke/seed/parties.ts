// ops/smoke/seed/parties.ts
// Canonical seeding based on MBapp-Relationships: Party with roles on the Party object.
// - Party(type='party') with kind: 'person' | 'organization' and roles: string[]
// - Note: partyRole is NOT a real object type; roles live on Party.roles and
//   are updated by GETing the party and PUTing the union of existing + new role.

export type ApiRes = { ok: boolean; status: number; body: any };
export type Api = {
  post: (path: string, body?: any) => Promise<ApiRes>;
  put:  (path: string, body?: any) => Promise<ApiRes>;
  get?: (path: string) => Promise<ApiRes>;
};

async function must(ok: boolean, err: () => string) {
  if (!ok) throw new Error(err());
}

async function createParty(api: Api, kind: "person" | "organization", name: string, roles?: string[]): Promise<string> {
  const rid = process.env.SMOKE_RUN_ID || `smk-${Date.now()}`;
  const taggedName = `${rid}-${name}`;
  const res = await api.post(`/objects/party`, {
    type: "party",
    kind,
    name: taggedName,
    ...(Array.isArray(roles) && roles.length ? { roles } : {}),
  });
  await must(!!res?.ok, () => `createParty failed ${res?.status}: ${JSON.stringify(res?.body)}`);
  const id = res.body?.id ?? res.body?.partyId;
  await must(!!id, () => `createParty: missing id in body ${JSON.stringify(res?.body)}`);
  return String(id);
}

async function addPartyRole(api: Api, partyId: string, role: "customer" | "vendor") {
  if (!api.get) throw new Error("addPartyRole requires api.get");

  // Load current party to preserve fields
  const current = await api.get(`/objects/party/${encodeURIComponent(partyId)}`);
  await must(!!current?.ok, () => `get party ${partyId} failed ${current?.status}: ${JSON.stringify(current?.body)}`);

  const party = current.body ?? {};
  const existingRoles = Array.isArray(party.roles) ? party.roles.map(String) : [];
  const nextRoles = Array.from(new Set([...existingRoles, role]));

  // If already has role, no-op
  if (existingRoles.includes(role)) {
    // Double-check presence (paranoia) before returning
    if (!existingRoles.includes(role)) {
      throw new Error(`addPartyRole(${role}) found inconsistent roles after GET: ${JSON.stringify(party)}`);
    }
    return;
  }

  const updated = { ...party, type: party.type || "party", roles: nextRoles };
  const putRes = await api.put(`/objects/party/${encodeURIComponent(partyId)}`, updated);
  await must(!!putRes?.ok, () => `addPartyRole(${role}) put failed ${putRes?.status}: ${JSON.stringify(putRes?.body)}`);

  // Verify by GET after PUT: roles must include the role
  const verify = await api.get(`/objects/party/${encodeURIComponent(partyId)}`);
  await must(!!verify?.ok, () => `addPartyRole(${role}) verify get failed ${verify?.status}: ${JSON.stringify(verify?.body)}`);
  const vParty = verify.body ?? {};
  const vRoles = Array.isArray(vParty.roles) ? vParty.roles.map(String) : [];
  if (!vRoles.includes(role)) {
    throw new Error(`addPartyRole(${role}) missing role after PUT; body=${JSON.stringify(vParty)}`);
  }
}

// E1 helper: ensurePartyHasRole(api, partyId, role)
export async function ensurePartyHasRole(api: Api, partyId: string, role: "customer" | "vendor") {
  // Reuse addPartyRole which performs GET→union→PUT→GET assert
  await addPartyRole(api, partyId, role);
}

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

// Robust role ensure with retries to handle eventual consistency
export async function ensurePartyRole(api: Api, partyId: string, role: "customer" | "vendor") {
  if (!api.get) throw new Error("ensurePartyRole requires api.get");
  let lastGet: ApiRes | undefined;
  let lastPut: ApiRes | undefined;
  for (let attempt = 1; attempt <= 8; attempt++) {
    lastGet = await api.get(`/objects/party/${encodeURIComponent(partyId)}`);
    if (!lastGet?.ok) throw new Error(`ensurePartyRole get failed ${lastGet?.status}: ${JSON.stringify(lastGet?.body)}`);
    const party = lastGet.body ?? {};
    const roles = Array.isArray(party.roles) ? party.roles.map(String) : [];
    if (roles.includes(role)) {
      return party; // success
    }
    // Union and PUT full object payload preserving fields
    const nextRoles = Array.from(new Set([...roles, role]));
    const updated = { ...party, type: party.type || "party", roles: nextRoles };
    lastPut = await api.put(`/objects/party/${encodeURIComponent(partyId)}`, updated);
    if (!lastPut?.ok) throw new Error(`ensurePartyRole put failed ${lastPut?.status}: ${JSON.stringify(lastPut?.body)}`);
    await sleep(150);
  }
  const body = lastGet?.body ?? {};
  throw new Error(`ensurePartyRole(${role}) missing after retries; lastGet=${JSON.stringify(lastGet)}; lastPut=${JSON.stringify(lastPut)}; body=${JSON.stringify(body)}`);
}

export async function seedParties(api: Api) {
  const partyId = await createParty(api, "person", "Seed Person");
  await addPartyRole(api, partyId, "customer");
  return { partyId };
}

// E1: seedCustomer(api) — create Party with roles ["customer"] and ensure via helper
export async function seedCustomer(api: Api) {
  const partyId = await createParty(api, "person", "Seed Customer", ["customer"]);
  const customerParty = await ensurePartyRole(api, partyId, "customer");
  return { partyId, customerId: partyId, customerParty };
}

export async function seedVendor(api: Api) {
  // Prefer setting vendor role at create time (roles live on Party.roles)
  const partyId = await createParty(api, "organization", "Seed Vendor", ["vendor"]);
  const vendorParty = await ensurePartyRole(api, partyId, "vendor");
  // Return canonical partyId; keep vendorId alias for back-compat and include party for debug
  return { partyId, vendorId: partyId, vendorParty };
}
