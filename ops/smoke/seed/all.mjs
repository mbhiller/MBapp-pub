#!/usr/bin/env node
import productsSeed from "./products.mjs";
import actorsSeed from "./actors.mjs";
import inventorySeed from "./inventory.mjs";
import poSeed from "./po.mjs";
import soSeed from "./so.mjs";
import eventsSeed from "./events.mjs";
import resourcesSeed from "./resources.mjs";
import regsSeed from ".reg/istrations.mjs";
import resvSeed from "./reservations.mjs";

export default async function run() {
  const products = await productsSeed();
  const { customers, vendors } = await actorsSeed();
  await inventorySeed({ products });

  const po = await poSeed({ vendorId: vendors[0].id, products });
  const so = await soSeed({ customerId: customers[0].id, products });

  const event = await eventsSeed();
  const resources = await resourcesSeed();
  const reg = await regsSeed({ eventId: event.id });
  const resv = await resvSeed({ resourceId: resources[0].id });

  return {
    test: "seed:all",
    result: "PASS",
    ids: {
      products: products.map(p => p.id),
      customer: customers[0]?.id,
      vendor: vendors[0]?.id,
      so: so.id,
      po: po.id,
      event: event.id,
      registration: reg.id,
      resource: resources[0].id,
      reservation: resv.id,
    }
  };
}

if (import.meta.main) run().then(r => console.log(JSON.stringify(r,null,2))).catch(e => { console.error(e); process.exit(1); });
