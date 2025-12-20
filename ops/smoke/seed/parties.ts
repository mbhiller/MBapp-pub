// ops/smoke/seed/parties.ts
// Canonical seeding based on MBapp-Relationships: Party + PartyRole
// - Party(type='party') with kind: 'person' | 'organization'
// - PartyRole(type='partyRole') with role: 'customer' | 'vendor'

export type ApiRes = { ok: boolean; status: number; body: any };
export type Api = {
  post: (path: string, body?: any) => Promise<ApiRes>;
  put:  (path: string, body?: any) => Promise<ApiRes>;
  get?: (path: string) => Promise<ApiRes>;
};

async function must(ok: boolean, err: () => string) {
  if (!ok) throw new Error(err());
}

async function createParty(api: Api, kind: "person" | "organization", name: string): Promise<string> {
  const res = await api.post(`/objects/party`, {
    type: "party",
    kind,
    name,
  });
  await must(!!res?.ok, () => `createParty failed ${res?.status}: ${JSON.stringify(res?.body)}`);
  const id = res.body?.id ?? res.body?.partyId;
  await must(!!id, () => `createParty: missing id in body ${JSON.stringify(res?.body)}`);
  return String(id);
}

async function addPartyRole(api: Api, partyId: string, role: "customer" | "vendor") {
  const res = await api.post(`/objects/partyRole`, {
    type: "partyRole",
    partyId,
    role,
  });
  await must(!!res?.ok, () => `addPartyRole(${role}) failed ${res?.status}: ${JSON.stringify(res?.body)}`);
}

export async function seedParties(api: Api) {
  const partyId = await createParty(api, "person", "Seed Person");
  await addPartyRole(api, partyId, "customer");
  return { partyId };
}

export async function seedVendor(api: Api) {
  const partyId = await createParty(api, "organization", "Seed Vendor");
  await addPartyRole(api, partyId, "vendor");
  return { vendorId: partyId };
}
