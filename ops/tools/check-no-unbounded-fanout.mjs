// Manual check to guard against reintroducing unbounded Promise.all fanout in PurchaseOrdersListPage.
// Run: node ops/tools/check-no-unbounded-fanout.mjs

import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const targetPath = path.join(__dirname, "../../apps/web/src/pages/PurchaseOrdersListPage.tsx");

const content = await readFile(targetPath, "utf8");
const pattern = /Promise\.all\s*\(\s*missing\.map\s*\(/;

if (pattern.test(content)) {
  console.error("Disallowed pattern found: Promise.all(missing.map(...)) in PurchaseOrdersListPage.tsx");
  process.exit(1);
}

console.log("check-no-unbounded-fanout: OK (no Promise.all(missing.map) in PurchaseOrdersListPage.tsx)");
