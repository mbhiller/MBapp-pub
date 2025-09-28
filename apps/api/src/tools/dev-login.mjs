#!/usr/bin/env node
// apps/api/src/tools/dev-login.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

/** Minimal .env loader that tries multiple likely locations */
function loadDotEnvCandidates(candidates) {
  let loaded = null;
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let [, k, v] = m;
        v = v.replace(/^['"]|['"]$/g, "");
        if (!(k in process.env)) process.env[k] = v;
      }
      loaded = p;
      break;
    } catch { /* keep trying */ }
  }
  return loaded;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Folders
const apiSrcDir     = path.resolve(__dirname, "..");   // apps/api/src
const apiDir        = path.resolve(apiSrcDir, "..");   // apps/api
const monorepoRoot  = path.resolve(apiDir, "..");      // repo root

// Prefer apps/api/.env (your actual location), but try a few
const candidates = [
  path.join(apiDir, ".env"),         // apps/api/.env  <-- primary
  path.join(apiSrcDir, ".env"),      // apps/api/src/.env (fallback)
  path.join(monorepoRoot, ".env"),   // repo root .env
  path.resolve(process.cwd(), ".env")
];

const loadedFrom = loadDotEnvCandidates(candidates);

// Inputs (prefer explicit env if already set)
const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error("JWT_SECRET is required. Not found in environment.");
  console.error("Searched for .env in:");
  candidates.forEach(c => console.error(" - " + c));
  if (loadedFrom) console.error(`Loaded env from: ${loadedFrom}`);
  process.exit(2);
}

const ISS   = process.env.JWT_ISSUER || "mbapp";
const SUB   = process.env.MBAPP_USER_ID || "dev-user";
const EMAIL = process.env.MBAPP_EMAIL || "dev@example.com";
const ROLES = (process.env.MBAPP_ROLES || "admin")
  .split(",").map(s => s.trim()).filter(Boolean);

const now = Math.floor(Date.now() / 1000);
const exp = now + 60 * 60; // 1 hour

// NOTE: do NOT include `iss` in the payload when also passing { issuer: ISS }
const claims = { sub: SUB, email: EMAIL, roles: ROLES, iat: now, exp };

let token;
try {
  token = jwt.sign(claims, SECRET, { issuer: ISS });
} catch (err) {
  console.error("Failed to sign JWT:", err?.message || err);
  process.exit(2);
}

const outPath = path.resolve(process.cwd(), ".mbapp.dev.jwt");
fs.writeFileSync(outPath, token, "utf8");

console.log(`Minted dev JWT → ${outPath} (expires in 1h)`);
if (loadedFrom) console.log(`Loaded .env from: ${loadedFrom}`);
console.log("");
console.log("PowerShell: set your bearer env and verify:");
console.log(`$env:MBAPP_BEARER = Get-Content "${outPath}" -Raw`);
console.log('Write-Host ("Token length: " + $env:MBAPP_BEARER.Length)');
