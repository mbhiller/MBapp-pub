import fs from "fs";
import { spawnSync } from "child_process";

const DEFAULT_TENANT = "SmokeTenant";
const allowNonSmokeTenant = process.env.MBAPP_SMOKE_ALLOW_NON_SMOKE_TENANT === "1";

// Read parent env BEFORE any changes
const envTenantId = process.env.MBAPP_TENANT_ID;

// Requested tenant priority: MBAPP_SMOKE_TENANT_ID -> MBAPP_TENANT_ID -> fallback (CI only) or fail
const requestedTenantRaw = process.env.MBAPP_SMOKE_TENANT_ID || envTenantId || "";
let requestedTenant = requestedTenantRaw;
if (!requestedTenant) {
  if (process.env.GITHUB_ACTIONS) {
    requestedTenant = DEFAULT_TENANT;
    console.log(`[ci-smokes] No tenant provided; defaulting requestedTenant to "${DEFAULT_TENANT}" for CI.`);
  } else {
    console.error(
      `[ci-smokes] No tenant provided. Set MBAPP_SMOKE_TENANT_ID (preferred) or MBAPP_TENANT_ID to a value starting with "${DEFAULT_TENANT}".`
    );
    process.exit(2);
  }
}

// Guard: requested tenant must start with "SmokeTenant" unless override
if (!allowNonSmokeTenant && !requestedTenant.startsWith(DEFAULT_TENANT)) {
  console.error(
    `[ci-smokes] Requested tenant is "${requestedTenant}" but must start with "${DEFAULT_TENANT}".\n` +
    `  Set MBAPP_SMOKE_ALLOW_NON_SMOKE_TENANT=1 to override.\n` +
    `  (Set MBAPP_SMOKE_TENANT_ID="${DEFAULT_TENANT}" for local runs)`
  );
  process.exit(2);
}

// Generate unique SMOKE_RUN_ID for this run (never "latest")
const parentSmokeRunId = process.env.SMOKE_RUN_ID;
const smokeRunId = (!parentSmokeRunId || parentSmokeRunId === "latest")
  ? `smk-${Date.now()}-${Math.random().toString(36).slice(2,6)}`
  : parentSmokeRunId;

function acquireBearerFromScript() {
  const ps = spawnSync("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "ops/ci/Emit-CIEnv.ps1", "-EmitTokenOnly"], { encoding: "utf8" });
  if (ps.status !== 0) {
    console.error("[ci-smokes] failed to acquire token:", ps.stderr || ps.stdout);
    process.exit(ps.status ?? 1);
  }
  const out = (ps.stdout || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const tok = out[out.length - 1] || "";
  if (!tok || tok.includes(" ")) {
    console.error("[ci-smokes] invalid/empty token emitted");
    process.exit(1);
  }
  return tok;
}

// Select bearer: prefer Smoke-specific, then generic, then dev token, else acquire
let selectedBearer = (process.env.MBAPP_BEARER_SMOKE || "").trim();
let selectedTokenVar = selectedBearer ? "MBAPP_BEARER_SMOKE" : null;
if (!selectedBearer) {
  const generic = (process.env.MBAPP_BEARER || "").trim();
  if (generic) {
    selectedBearer = generic;
    selectedTokenVar = "MBAPP_BEARER";
  }
}
if (!selectedBearer) {
  const devTok = (process.env.DEV_API_TOKEN || "").trim();
  if (devTok) {
    selectedBearer = devTok;
    selectedTokenVar = "DEV_API_TOKEN";
  }
}
if (!selectedBearer) {
  selectedBearer = acquireBearerFromScript();
  selectedTokenVar = "MBAPP_BEARER";
}

process.env.MBAPP_BEARER = selectedBearer;
if (!process.env.DEV_API_TOKEN) process.env.DEV_API_TOKEN = selectedBearer;

const DEFAULT_BASE = "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";
if (!process.env.MBAPP_API_BASE || !process.env.MBAPP_API_BASE.trim()) {
  process.env.MBAPP_API_BASE = DEFAULT_BASE;
}

// Helper: decode JWT payload (base64url) and return mbapp.tenantId if present
function decodeJwtTenant(bearer){
  try{
    const tok = String(bearer||"").trim();
    const parts = tok.split(".");
    if(parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = Buffer.from(b64, "base64").toString("utf8");
    const payload = JSON.parse(json);
    const t = payload?.mbapp?.tenantId;
    return t ? String(t) : null;
  }catch{ return null; }
}
const jwtTenant = decodeJwtTenant(process.env.MBAPP_BEARER);

const cfgPath = "ops/ci-smokes.json";
if (!fs.existsSync(cfgPath)) {
  console.error(`[ci-smokes] Missing ${cfgPath}`);
  process.exit(1);
}
const { flows } = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
if (!Array.isArray(flows) || flows.length === 0) {
  console.error("[ci-smokes] No flows found in ops/ci-smokes.json");
  process.exit(1);
}

// Extended/opt-in smokes (manual only; keep out of CI):
//   - smoke:close-the-loop-multi-vendor (excluded below)
//   - smoke:close-the-loop-partial-receive (run manually via ops/smoke/smoke.mjs)
// Prevent churn: exclude multi-vendor flow from CI by default
const filteredFlows = flows.filter((f) => f !== "smoke:close-the-loop-multi-vendor");
if (filteredFlows.length !== flows.length) {
  console.log("[ci-smokes] Excluding opt-in flow: smoke:close-the-loop-multi-vendor");
}

// Guard: bearer tenant must match requested tenant unless explicit dual overrides
const allowTenantMismatch = process.env.MBAPP_SMOKE_ALLOW_TENANT_MISMATCH === "1";
const isCIStrict = process.env.CI === "true";
const originalRequestedTenant = requestedTenant;
if (jwtTenant && jwtTenant !== requestedTenant) {
  if (isCIStrict) {
    console.error(
      `[ci-smokes] Need SmokeTenant JWT (MBAPP_BEARER_SMOKE).\n` +
      `  originalRequestedTenant=${originalRequestedTenant}\n` +
      `  jwtTenant=${jwtTenant}`
    );
    process.exit(2);
  }
  // Local runs: only allow running in non-Smoke tenant if BOTH overrides are set
  if (allowNonSmokeTenant && allowTenantMismatch) {
    requestedTenant = jwtTenant; // user explicitly opts to run under the token's tenant
  } else {
    console.error(
      `[ci-smokes] Token tenant mismatch.\n` +
      `  originalRequestedTenant=${originalRequestedTenant}\n` +
      `  jwtTenant=${jwtTenant}\n` +
      `  Set MBAPP_SMOKE_ALLOW_NON_SMOKE_TENANT=1 AND MBAPP_SMOKE_ALLOW_TENANT_MISMATCH=1 to run in "${jwtTenant}" locally.`
    );
    process.exit(2);
  }
}

console.log(JSON.stringify({
  base: process.env.MBAPP_API_BASE,
  originalRequestedTenant,
  finalRequestedTenant: requestedTenant,
  smokeTenantId: process.env.MBAPP_SMOKE_TENANT_ID || null,
  envTenantId,
  childTenantId: requestedTenant,
  smokeRunId,
  tokenVar: selectedTokenVar,
  hasToken: Boolean(selectedBearer),
  jwtTenant,
  allowMismatch: allowTenantMismatch,
  allowNonSmokeTenant
}));

console.log(`[ci-smokes] Running ${filteredFlows.length} flows:`);
filteredFlows.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
// Prepare child env with requestedTenant (final) and unique SMOKE_RUN_ID
const childEnv = {
  ...process.env,
  MBAPP_TENANT_ID: requestedTenant,
  SMOKE_RUN_ID: smokeRunId
};

const isCI = Boolean(process.env.GITHUB_ACTIONS);
for (const flow of filteredFlows) {
  if (isCI) {
    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    console.log(`[ci-smokes] → npx tsx ops/smoke/smoke.mjs ${flow}`);
    const check = spawnSync(npxCmd, ["tsx", "--version"], { stdio: "ignore" });
    if (check.status !== 0) {
      console.error("[ci-smokes] tsx is not available in CI. Falling back to node (may fail on .ts imports).");
      const nodeCmd = process.execPath || (process.platform === "win32" ? "node.exe" : "node");
      const res = spawnSync(nodeCmd, ["ops/smoke/smoke.mjs", flow], { stdio: "inherit", env: childEnv });
      if (res.status !== 0) process.exit(res.status ?? 1);
      continue;
    }
    const res = spawnSync(npxCmd, ["tsx", "ops/smoke/smoke.mjs", flow], { stdio: "inherit", env: childEnv });
    if (res.status !== 0) process.exit(res.status ?? 1);
  } else {
    const nodeCmd = process.execPath || (process.platform === "win32" ? "node.exe" : "node");
    console.log(`[ci-smokes] → node ops/smoke/smoke.mjs ${flow}`);
    const res = spawnSync(nodeCmd, ["ops/smoke/smoke.mjs", flow], { stdio: "inherit", env: childEnv });
    if (res.status !== 0) process.exit(res.status ?? 1);
  }
}

console.log("[ci-smokes] ✔ all flows passed");
