#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ciSmokeFile = path.join(__dirname, "../ci-smokes.json");

// 1. Read ci-smokes.json
const ciConfig = JSON.parse(fs.readFileSync(ciSmokeFile, "utf-8"));
const flows = ciConfig.flows || [];

console.log(`\n🔄 Running ${flows.length} CI smokes...\n`);

let passed = 0;
let failed = 0;
const results = [];

// 2. Run each flow sequentially
for (const flow of flows) {
  try {
    console.log(`  ⏳ ${flow}...`);
    execSync(`npm run ${flow}`, { stdio: "inherit" });
    console.log(`  ✅ ${flow}\n`);
    passed++;
    results.push({ flow, status: "PASS" });
  } catch (e) {
    console.error(`  ❌ ${flow}\n`);
    failed++;
    results.push({ flow, status: "FAIL" });
    process.exit(1); // Fail fast
  }
}

// 3. Print summary
console.log("\n" + "=".repeat(60));
console.log(`✅ All ${flows.length} smokes passed!`);
console.log("=".repeat(60) + "\n");
console.log(JSON.stringify({ total: flows.length, passed, failed, results }, null, 2));
