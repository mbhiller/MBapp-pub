#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rel = (p) => pathToFileURL(path.join(__dirname, p)).href;

const [, , cmd] = process.argv;

function getFlag(name, dflt = undefined) {
  const i = process.argv.findIndex(a => a === `--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : (process.env[`SMOKE_${name.toUpperCase()}`] ?? dflt);
}

async function main() {
// #################   PURGE ALL ################################################
  if (cmd === "purge:all") {
    const mod = await import(rel("./steps/purge-all.mjs"));
    const out = await mod.run();
    console.log(JSON.stringify(out, null, 2));
    return;
  }
// #################   SEED ALL   ################################################
  if (cmd === "seed:all") {
    const mod = await import(rel("./steps/seed-all.mjs"));
    const out = await mod.run();
    console.log(JSON.stringify(out, null, 2));
    return;
  }

// #################   SO FLOW    ################################################
  if (cmd === "sales:so:flow") {
    const mod = await import(rel("./steps/sales-so-flow.mjs"));
    const out = await mod.run(); console.log(JSON.stringify(out, null, 2)); process.exit(0);
  }
// #################   PO FLOW    ################################################
  if (cmd === "purchasing:po:flow") {
    const mod = await import(rel("./steps/purchasing-po-flow.mjs"));
    const out = await mod.run(); console.log(JSON.stringify(out, null, 2)); process.exit(0);
  }
  // #################   BackFill Role Flags   ###################################
  if (cmd === "backfill:party:roleFlags") {
    const mod = await import(rel("./steps/backfill-denorm-roles.mjs"));
    const out = await mod.run(); console.log(JSON.stringify(out, null, 2)); process.exit(0);
  }
  if (cmd === "sales:so:release") {
    const mod = await import(rel("./steps/sales-so-release.mjs"));
    const out = await mod.run(); console.log(JSON.stringify(out, null, 2)); process.exit(0);
  }
  if (cmd === "sales:so:fulfill") {
    const mod = await import(rel("./steps/sales-so-fulfill.mjs"));
    const out = await mod.run(); console.log(JSON.stringify(out, null, 2)); process.exit(0);
  }
  if (cmd === "check:onhand") {
      const { run } = await import("./steps/check-onhand.mjs");
      const itemId = getFlag("item");
      const out = await run({ itemId });
      console.log(JSON.stringify(out, null, 2));
      process.exit(0);
    }

  console.error("Usage: node ops/smoke/smoke.mjs <purge:all|seed:all>");
  process.exit(2);
}
main().catch(e => { console.error(e?.message || e); process.exit(1); });
