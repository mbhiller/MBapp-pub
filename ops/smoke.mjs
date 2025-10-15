#!/usr/bin/env node
/* New smoke runner that adds purge/seed/verify/guards, and falls back to _smoke.mjs
   for any legacy commands you already support. */

import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import path from "node:path";

// ------------------------- arg parsing ---------------------------------
const [, , cmd, ...argv] = process.argv;
const arg = Object.create(null);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=");
    const next = v ?? (argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[++i] : "1");
    arg[k] = next;
  } else if (a.startsWith("-")) {
    const k = a.slice(1);
    const next = argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[++i] : "1";
    arg[k] = next;
  } else if (a.includes("=")) {
    const [k, v] = a.split("=");
    arg[k] = v;
  }
}

// Small helpers
const here = path.dirname(fileURLToPath(import.meta.url));
const rel = (p) => path.join(here, p);
const importRel = async (p) => import(pathToFileURL(rel(p)).href);
const asInt = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// ------------------------- NEW COMMANDS --------------------------------

// PURGE ALL (uses new flows/purge/all.mjs)
if (cmd === "smoke:purge:all") {
  const mod = await importRel("./smoke/purge/all.mjs");
  const out = await mod.default.run?.() ?? await mod.run?.() ?? await mod.default();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out?.result === "PASS" ? 0 : 1);
}

// SEED ALL (uses new seed modules; configurable counts)
if (cmd === "smoke:seed:all") {
  // Counts (defaults chosen to give good coverage; tune as needed)
  const counts = {
    products:      asInt(arg.products,      6),
    customers:     asInt(arg.customers,     4),
    vendors:       asInt(arg.vendors,       2),
    resources:     asInt(arg.resources,     3),
    events:        asInt(arg.events,        2),
    registrations: asInt(arg.registrations, 4),
    reservations:  asInt(arg.reservations,  4),
    soLines:       asInt(arg.soLines ?? arg.so, 2),
    poLines:       asInt(arg.poLines ?? arg.po, 3),
  };

  // Import seed helpers
  const productsSeed   = (await importRel("./smoke/seed/products.mjs")).default;
  const partiesSeed    = (await importRel("./smoke/seed/parties.mjs")).default;
  const linksSeed      = (await importRel("./smoke/seed/links.mjs")).default;
  const inventorySeed  = (await importRel("./smoke/seed/inventory.mjs")).default;
  const poSeed         = (await importRel("./smoke/seed/po.mjs")).default;
  const soSeed         = (await importRel("./smoke/seed/so.mjs")).default;
  const eventsSeed     = (await importRel("./smoke/seed/events.mjs")).default;
  const classesSeed    = (await importRel("./smoke/seed/classes.mjs")).default;
  const resourcesSeed  = (await importRel("./smoke/seed/resources.mjs")).default;
  const regsSeed       = (await importRel("./smoke/seed/registrations.mjs")).default;
  const resvSeed       = (await importRel("./smoke/seed/reservations.mjs")).default;

  // Expand seeders to produce multiple records
  const seeded = { products: [], customers: [], vendors: [], resources: [], events: [], registrations: [], reservations: [] };

  // products
  while (seeded.products.length < counts.products) {
    const batch = await productsSeed();
    // productsSeed returns 3 in our baseline; loop until target
    for (const p of batch) seeded.products.push(p);
    if (seeded.products.length >= counts.products) seeded.products = seeded.products.slice(0, counts.products);
  }

  // parties (people/orgs/animals) + roles
  const parties = await partiesSeed({ people: counts.customers, orgs: counts.vendors, animals: 2 });
  // derive “customers” and “vendors” from roles for convenience
  seeded.customers = parties.people.slice(0, counts.customers); // first N people (customer role assigned in seeder)
  seeded.vendors   = parties.orgs.slice(0, counts.vendors);     // first M orgs (vendor role assigned in seeder)

  // optional link: first person owns first animal (demonstration)
  if (parties.people[0] && parties.animals[0]) await linksSeed({ ownerPartyId: parties.people[0].id, animalPartyId: parties.animals[0].id });

   // inventory items for all seeded products (SO/PO lines need itemId)
  const inventoryItems = await inventorySeed({ products: seeded.products || [] });

  // one or more POs / SOs (use first vendor/customer; generate multiple by varying lines)
  const so = [];
  const po = [];
  for (let i = 0; i < Math.max(1, Math.ceil(counts.products / 3)); i++) {
    const cust = seeded.customers[i % seeded.customers.length];
    const soObj = await soSeed({
    partyId: cust.id,
    customerId: undefined,
    customerName: cust.displayName ?? cust.name ?? "Customer",
    items: (inventoryItems || []).slice(0, Math.max(1, counts.soLines)),
    });
        so.push(soObj);
        const vend = seeded.vendors[i % seeded.vendors.length];
    const poObj = await poSeed({
      partyId: vend.id,
      vendorId: undefined,
      vendorName: vend.displayName ?? vend.name ?? "Vendor",
      items: (inventoryItems || []).slice(0, Math.max(1, counts.poLines)),
    });
    po.push(poObj);
  }

  // resources
  while (seeded.resources.length < counts.resources) {
    const batch = await resourcesSeed();
    for (const r of batch) seeded.resources.push(r);
    if (seeded.resources.length >= counts.resources) seeded.resources = seeded.resources.slice(0, counts.resources);
  }

  // events
  while (seeded.events.length < counts.events) {
    const e = await eventsSeed();
    seeded.events.push(e);
    if (seeded.events.length >= counts.events) seeded.events = seeded.events.slice(0, counts.events);
  }
  // classes per event (4 by default; tune with --classes)
    const classesByEvent = new Map();
    const perEvent = asInt(arg.classes, 4);
    for (const ev of seeded.events) {
      const cls = await classesSeed({ eventId: ev.id, count: perEvent });
      classesByEvent.set(ev.id, cls);
    }
  // registrations tied to first event
  if (seeded.events.length && seeded.customers.length) {
    for (let i = 0; i < counts.registrations; i++) {
      const ev = seeded.events[i % seeded.events.length];
      const cl = seeded.customers[i % seeded.customers.length];
      const reg = await regsSeed({ eventId: ev.id, partyId: cl.id, clientId: undefined, clientName: cl.displayName ?? cl.name });
      seeded.registrations.push(reg);
    }
  }

  // reservations tied to first resource
  if (seeded.resources.length && seeded.customers.length) {
    for (let i = 0; i < counts.reservations; i++) {
      const r  = seeded.resources[i % seeded.resources.length];
      const cl = seeded.customers[i % seeded.customers.length];
      const resv = await resvSeed({ resourceId: r.id, partyId: cl.id, clientId: undefined, clientName: cl.displayName ?? cl.name });
      seeded.reservations.push(resv);
    }
  }

  const out = {
    test: "seed:all",
    result: "PASS",
    counts,
    ids: {
      products: seeded.products.map(p => p.id),
      customers: seeded.customers.map(c => c.id),
      vendors: seeded.vendors.map(v => v.id),
      so: so.map(x => x.id),
      po: po.map(x => x.id),
      events: seeded.events.map(e => e.id),
      classes: [...classesByEvent.values()].flat().map(c => c.id),
      registrations: seeded.registrations.map(r => r.id),
      resources: seeded.resources.map(r => r.id),
      reservations: seeded.reservations.map(r => r.id),
    }
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

// VERIFY: combined edit-in-place for registrations, SO, PO
if (cmd === "smoke:verify:edits") {
  const mod = await importRel("./smoke/flows/verify-edits.mjs");
  const out = await (mod.run?.() ?? mod.default?.run?.());
  console.log(JSON.stringify(out, null, 2));
  process.exit(out?.result === "PASS" ? 0 : 1);
}

// REGISTRATIONS: edit in place (focused)
if (cmd === "smoke:registrations:edit-in-place") {
  const mod = await importRel("./smoke/flows/registrations/edit-in-place.mjs");
  const out = await (mod.run?.() ?? mod.default?.run?.());
  console.log(JSON.stringify(out, null, 2));
  process.exit(out?.result === "PASS" ? 0 : 1);
}

// EVENTS: capacity guard
if (cmd === "smoke:events:capacity-guard") {
  const mod = await importRel("./smoke/flows/events/capacity-guard.mjs");
  const out = await (mod.run?.() ?? mod.default?.run?.());
  console.log(JSON.stringify(out, null, 2));
  process.exit(out?.result === "PASS" ? 0 : 1);
}

// RESERVATIONS: conflict guard
if (cmd === "smoke:reservations:conflict-guard") {
  const mod = await importRel("./smoke/flows/reservations/conflict-guard.mjs");
  const out = await (mod.run?.() ?? mod.default?.run?.());
  console.log(JSON.stringify(out, null, 2));
  process.exit(out?.result === "PASS" ? 0 : 1);
}

if (cmd === "smoke:salesOrder:require-customer-role") {
  const mod = await importRel("./smoke/flows/salesOrder-require-customer-role.mjs");
  const out = await (mod.run?.() ?? mod.default?.run?.());
  console.log(JSON.stringify(out, null, 2)); process.exit(out?.result === "PASS" ? 0 : 1);
}
if (cmd === "smoke:purchaseOrder:require-vendor-role") {
  const mod = await importRel("./smoke/flows/purchaseOrder-require-vendor-role.mjs");
  const out = await (mod.run?.() ?? mod.default?.run?.());
  console.log(JSON.stringify(out, null, 2)); process.exit(out?.result === "PASS" ? 0 : 1);
}

// -------------------- FALLBACK TO YOUR _smoke.mjs ----------------------
// Anything not matched above will be executed by your backed-up runner.
// This preserves all of your existing commands verbatim (SO/PO flows, guardrails, reports, etc.)

if (!cmd) {
  console.error("Usage: node ops/smoke.mjs <command> [--flags]");
  process.exit(2);
}

// Forward to _smoke.mjs as a separate process so its CLI runs normally.
{
  const child = spawnSync(process.execPath, [rel("./_smoke.mjs"), ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(child.status ?? 1);
}
