import { api } from "../core.mjs";
import { safeCreate, uniqueName, uniqueEmail } from "./util.mjs";

async function createParty(kind, name) {
  return safeCreate("party", {
    type: "party",
    kind,
    displayName: name,
    email: uniqueEmail(name),
    phone: `555-${1000 + Math.floor(Math.random()*9000)}`,
    status: "active",
  }, (b)=>({ ...b, displayName: uniqueName(kind === "animal" ? "Animal" : kind) }));
}

async function addRole(partyId, role) {
  return api("/objects/partyRole", { method:"POST", body: { type:"partyRole", partyId, role, active: true } });
}

export default async function seedParties({ people=3, orgs=2, animals=2 } = {}) {
  const peopleArr = [], orgArr = [], animalArr = [];
  for (let i=0;i<people;i++)  peopleArr.push(await createParty("person",       uniqueName("Person")));
  for (let i=0;i<orgs;i++)    orgArr.push(   await createParty("organization", uniqueName("Org")));
  for (let i=0;i<animals;i++) animalArr.push(await createParty("animal",       uniqueName("Animal")));

  // Assign roles: first 2 people = customers, first org = vendor
  for (let i=0;i<Math.min(2, peopleArr.length); i++) await addRole(peopleArr[i].id, "customer");
  if (orgArr[0]) await addRole(orgArr[0].id, "vendor");

  return { people: peopleArr, orgs: orgArr, animals: animalArr };
}
