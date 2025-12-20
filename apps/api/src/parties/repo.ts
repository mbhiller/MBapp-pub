//apps/api/src/parties/repo.ts
// A thin repo abstraction. Replace internals with DynamoDB.
// For now, a simple in-memory map so handlers compile and your smokes can hit something predictable.

import { Party, PartyId, CreatePartyInput } from './types';

const _db = new Map<PartyId, Party>();
let _seq = 0;

function newId() {
  _seq += 1;
  return `pty_${_seq.toString(36)}`;
}

export async function createParty(input: CreatePartyInput): Promise<Party> {
  const now = new Date().toISOString();
  const party: Party = {
    id: newId(),
    kind: input.kind,
    name: input.name,
    roles: [],
    createdAt: now,
    updatedAt: now,
  };
  _db.set(party.id, party);
  return party;
}

export async function addRole(partyId: PartyId, role: string): Promise<Party | null> {
  const p = _db.get(partyId);
  if (!p) return null;
  if (!p.roles.includes(role)) p.roles.push(role);
  p.updatedAt = new Date().toISOString();
  _db.set(partyId, p);
  return p;
}

export async function getParty(partyId: PartyId): Promise<Party | null> {
  return _db.get(partyId) ?? null;
}

export interface PartySearchOpts {
  role?: string;
  q?: string;
}

export async function searchParties(opts: PartySearchOpts): Promise<Party[]> {
  const q = (opts.q ?? '').toLowerCase();
  return [..._db.values()].filter(p => {
    if (opts.role && !p.roles.includes(opts.role)) return false;
    if (q && !p.name.toLowerCase().includes(q)) return false;
    return true;
  });
}
