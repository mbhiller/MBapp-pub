import fs from "fs";
import { spawnSync } from "child_process";

function getBearer() {
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

const token = getBearer();
process.env.MBAPP_BEARER = token;
if (!process.env.DEV_API_TOKEN) process.env.DEV_API_TOKEN = token;

const DEFAULT_BASE = "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";
if (!process.env.MBAPP_API_BASE || !process.env.MBAPP_API_BASE.trim()) {
  process.env.MBAPP_API_BASE = DEFAULT_BASE;
}

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

console.log(JSON.stringify({
  base: process.env.MBAPP_API_BASE,
  tokenVar: process.env.MBAPP_BEARER ? "MBAPP_BEARER" : (process.env.DEV_API_TOKEN ? "DEV_API_TOKEN" : null),
  hasToken: Boolean(process.env.MBAPP_BEARER || process.env.DEV_API_TOKEN)
}));

console.log(`[ci-smokes] Running ${flows.length} flows:`);
flows.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));

const isCI = Boolean(process.env.GITHUB_ACTIONS);
for (const flow of flows) {
  if (isCI) {
    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    console.log(`[ci-smokes] → npx tsx ops/smoke/smoke.mjs ${flow}`);
    const check = spawnSync(npxCmd, ["tsx", "--version"], { stdio: "ignore" });
    if (check.status !== 0) {
      console.error("[ci-smokes] tsx is not available in CI. Falling back to node (may fail on .ts imports).");
      const nodeCmd = process.execPath || (process.platform === "win32" ? "node.exe" : "node");
      const res = spawnSync(nodeCmd, ["ops/smoke/smoke.mjs", flow], { stdio: "inherit", env: process.env });
      if (res.status !== 0) process.exit(res.status ?? 1);
      continue;
    }
    const res = spawnSync(npxCmd, ["tsx", "ops/smoke/smoke.mjs", flow], { stdio: "inherit", env: process.env });
    if (res.status !== 0) process.exit(res.status ?? 1);
  } else {
    const nodeCmd = process.execPath || (process.platform === "win32" ? "node.exe" : "node");
    console.log(`[ci-smokes] → node ops/smoke/smoke.mjs ${flow}`);
    const res = spawnSync(nodeCmd, ["ops/smoke/smoke.mjs", flow], { stdio: "inherit", env: process.env });
    if (res.status !== 0) process.exit(res.status ?? 1);
  }
}

console.log("[ci-smokes] ✔ all flows passed");
