// build-objects.mjs
// Bundles the Objects Lambda entrypoint with esbuild (Node API).
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

function getArg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const entry   = getArg("--entry", "apps/api/src/index.ts");
const outfile = getArg("--outfile", "infra/terraform/build/index.js");

// ensure output dir exists
fs.mkdirSync(path.dirname(outfile), { recursive: true });

try {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",           // Lambda Node.js 20 expects CommonJS handler exports
    sourcemap: false,
    logLevel: "info"
  });
  console.log(`✅ Built ${outfile}`);
} catch (e) {
  console.error("❌ esbuild failed:", e?.message || e);
  process.exit(1);
}
