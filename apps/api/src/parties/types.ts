// Keep tiny local types to avoid over-coupling; map them to your generated OpenAPI if desired.
export type PartyId = string;

export type PartyKind = 'person' | 'org';

export interface Party {
  id: PartyId;
  kind: PartyKind;
  name: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  roles: string[];   // ['customer','vendor','employee',...]
  // Add any additional fields you snapshot/denormalize later (addresses, contacts)
}

export interface CreatePartyInput {
  kind: PartyKind;
  name: string;
}
