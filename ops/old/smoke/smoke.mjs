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
function hasFlag(name) {
  return process.argv.some(a => a === `--${name}`);
}

async function main() {
  if (cmd === "auth:dev-login") {
  const { api, ps1SetEnvLine, setBearer } = await import("./core.mjs");
  const tenant = getFlag("tenant", process.env.MBAPP_TENANT_ID || "DemoTenant");
  const email  = getFlag("email", "dev@example.com");
  const roles  = (getFlag("roles","admin")||"").split(",").map(s=>s.trim()).filter(Boolean);
  const policyF = getFlag("policy","full");
  const policy = policyF === "full" ? {"*": true} : (()=>{ try { return JSON.parse(policyF); } catch { return {"*": true}; } })();

  const res = await api("/auth/dev-login", {
    method: "POST",
    body: { email, tenantId: tenant, roles, policy },
  });
  const token = res?.token || "";
  if (!token) throw new Error("dev-login returned no token");

  setBearer(token);

  if (hasFlag("export")) {
    const { ps1SetEnvLine } = await import("./core.mjs");
    console.log(ps1SetEnvLine(token));
  } else {
    console.log(JSON.stringify({ ok: true, tenant, email, roles }, null, 2));
  }
  process.exit(0);
}
  // ======== login (mint HS256, set env, optional export) ========
  if (cmd === "login") {
    const { mintHs256Token, setBearer, ps1SetEnvLine, writeTokenFiles } = await import("./core.mjs");

    const tenant  = getFlag("tenant",  process.env.MBAPP_TENANT_ID || "DemoTenant");
    const email   = getFlag("email",   "dev@example.com"); // used as userId
    const roles   = (getFlag("roles",  "admin") || "").split(",").map(s => s.trim()).filter(Boolean);
    const hours   = Number(getFlag("hours", "6"));
    const policyF = getFlag("policy", "full");
    const policy  = policyF === "full" ? {"*": true} : (() => { try { return JSON.parse(policyF); } catch { return {"*": true}; } })();

    // allow override via flags; otherwise use env (MBAPP_JWT_SECRET_B64 or JWT_SECRET for base64)
    const secretB64  = getFlag("secret-b64") || process.env.MBAPP_JWT_SECRET_B64 || process.env.JWT_SECRET || "";
    const secretText = getFlag("secret")     || process.env.MBAPP_JWT_SECRET     || "";

    const iss = getFlag("iss", "mbapp");
    const aud = getFlag("aud", "mbapp");
    const mode = getFlag("mode", "mbapp"); // "mbapp" or "flat"

    const token = mintHs256Token({
      tenantId: tenant,
      userId: email,
      roles,
      policy,
      hours,
      secretB64,
      secretText,
      iss,
      aud,
      mode,
    });

    setBearer(token);
    // --export prints a PowerShell line so you can capture into $Env:MBAPP_BEARER
    if (hasFlag("export")) {
      console.log(ps1SetEnvLine(token));
      return;
    }


    // persist a convenience script at ops/.env.ps1 unless disabled
    if (getFlag("persist", "1") !== "0") {
      const r = await writeTokenFiles(token);
      console.log(JSON.stringify({ ok: true, ps1: r.ps1Path, tenant, email, roles, hours }, null, 2));
    } else {
      console.log(JSON.stringify({ ok: true, tenant, email, roles, hours }, null, 2));
    }
    return;
  }

  // #################   PURGE ALL   ##############################
  if (cmd === "purge:all") {
    const mod = await import(rel("./steps/purge-all.mjs"));
    const out = await mod.run();
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  // #################   SEED ALL   ###############################
  if (cmd === "seed:all") {
    const mod = await import(rel("./steps/seed-all.mjs"));
    const out = await mod.run();
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  // #################   SO FLOW    ###############################
  if (cmd === "sales:so:flow") {
    const mod = await import(rel("./steps/sales-so-flow.mjs"));
    const out = await mod.run(); console.log(JSON.stringify(out, null, 2)); process.exit(0);
  }

  // #################   PO FLOW    ###############################
  if (cmd === "purchasing:po:flow") {
    const mod = await import(rel("./steps/purchasing-po-flow.mjs"));
    const out = await mod.run(); console.log(JSON.stringify(out, null, 2)); process.exit(0);
  }

  // #############   backfill role flags   ########################
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

  console.error("Usage: node ops/smoke/smoke.mjs <login|purge:all|seed:all|sales:so:flow|purchasing:po:flow|check:onhand>");
  process.exit(2);
}
main().catch(e => { console.error(e?.message || e); process.exit(1); });
