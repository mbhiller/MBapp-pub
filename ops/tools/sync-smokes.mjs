#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const smokeFile = path.join(__dirname, "../smoke/smoke.mjs");
const packageFile = path.join(__dirname, "../../package.json");

// 1. Read smoke.mjs and extract flow keys
const smokeContent = fs.readFileSync(smokeFile, "utf-8");
const flowRegex = /"smoke:[a-z0-9:-]+"/gi;
const matches = smokeContent.match(flowRegex) || [];
const discovered = [...new Set(matches.map(m => m.slice(1, -1)))].sort();

// 2. Load package.json
const pkgContent = fs.readFileSync(packageFile, "utf-8");
const pkg = JSON.parse(pkgContent);
pkg.scripts = pkg.scripts || {};

// 3. Check which flows need to be added
const added = [];
const skipped = [];
for (const flow of discovered) {
  if (pkg.scripts[flow]) {
    skipped.push(flow);
  } else {
    pkg.scripts[flow] = `node ops/smoke/smoke.mjs ${flow}`;
    added.push(flow);
  }
}

// 4. Update package.json if changes were made
if (added.length > 0) {
  fs.writeFileSync(packageFile, JSON.stringify(pkg, null, 2) + "\n");
}

// 5. Print summary
const summary = { discovered: discovered.length, added: added.length, skipped: skipped.length };
console.log(JSON.stringify(summary, null, 2));
if (added.length > 0) {
  console.log(`\nAdded scripts:\n${added.map(f => `  "${f}": "node ops/smoke/smoke.mjs ${f}"`).join("\n")}`);
}
