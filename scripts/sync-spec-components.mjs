// scripts/sync-spec-components.mjs
import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

// paths (tweak if yours differ)
const SRC = path.resolve("spec/openapi.yaml");          // the CORRECT spec (old, working)
const DST = path.resolve("spec/MBapp-Modules.yaml"); // the SSOT we want to fix

const srcText = fs.readFileSync(SRC, "utf8");
const dstText = fs.readFileSync(DST, "utf8");

const src = yaml.parse(srcText);
const dst = yaml.parse(dstText);

// sanity
if (!src?.components) throw new Error("Source openapi.yaml has no components");
dst.components ||= {};

//
// Copy EXACTLY the sections you want the app/types to reflect.
// Start with 'schemas' (the mobile compile errors are all here).
// If you also rely on shared parameters/requestBodies/responses, copy those too.
//
const copyKeys = ["schemas", "parameters", "requestBodies", "responses"];

for (const k of copyKeys) {
  if (src.components[k]) {
    dst.components[k] = src.components[k];
  }
}

// Optional: keep dst.info/title/version, tags, servers as-is.
// If you want to mirror those too, copy them similarly.

// Write back
const out = yaml.stringify(dst);
fs.writeFileSync(DST, out, "utf8");
console.log(`✔ Synced components (${copyKeys.join(", ")}) from ${SRC} → ${DST}`);
