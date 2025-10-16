// ops/smoke/core.mjs
import { setTimeout as wait } from "node:timers/promises";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const API_BASE  = process.env.MBAPP_API_BASE  || process.env.EXPO_PUBLIC_API_BASE  || "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";
export const TENANT_ID = process.env.MBAPP_TENANT_ID || process.env.EXPO_PUBLIC_TENANT_ID || "DemoTenant";

// NOTE: read bearer fresh each call so "login" can set env at runtime
function readBearer() { return process.env.MBAPP_BEARER || ""; }

function headers(extra = {}) {
  const h = {
    "content-type": "application/json",
    accept: "application/json",
    "x-tenant-id": TENANT_ID,
    ...extra,
  };
  const bearer = readBearer();
  if (bearer) h.authorization = `Bearer ${bearer}`;
  return h;
}

async function fetchJson(path, init, attempt = 0) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, init);
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const ms = Math.min(1800, 250 * (attempt + 1)) + Math.floor(Math.random() * 120);
      await wait(ms);
      return fetchJson(path, init, attempt + 1);
    }
    const msg = body?.message || body || `${res.status}`;
    const err = new Error(`HTTP ${res.status} ${path} — ${msg}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function api(path, { method = "GET", body, idem, hdrs = {} } = {}) {
  const h = headers(hdrs);
  if (idem) h["Idempotency-Key"] = idem;
  const init = { method, headers: h, body: body != null ? JSON.stringify(body) : undefined };
  return fetchJson(path, init);
}

export function normalizePage(res) {
  if (!res || typeof res !== "object") return { items: [] };
  if (Array.isArray(res)) return { items: res };
  if ("items" in res) return { items: Array.isArray(res.items) ? res.items : Object.values(res.items || {}), next: res.next };
  if ("rows"  in res) return { items: Array.isArray(res.rows)  ? res.rows  : Object.values(res.rows  || {}), next: res.next };
  if ("data"  in res) return { items: Array.isArray(res.data)  ? res.data  : Object.values(res.data  || {}), next: res.next };
  return { items: Object.values(res) };
}

// tags / idempotency helpers
export const nowTag = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
};
export const idem = (prefix = "smk") => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// ===== JWT helpers (added) =====
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");
}
function b64urlJson(obj) { return b64url(Buffer.from(JSON.stringify(obj))); }

/**
 * Mint an HS256 JWT your API accepts.
 * Secret precedence:
 *   - explicit secretB64/secretText args
 *   - env: MBAPP_JWT_SECRET_B64 or JWT_SECRET (base64)
 *   - env: MBAPP_JWT_SECRET (raw)
 */
export function mintHs256Token({
  tenantId,
  userId,
  roles = ["admin"],
  policy = {"*": true},
  hours = 6,
  iss = "mbapp",
  aud = "mbapp",
  secretB64,
  secretText,
}) {
  const envB64 = process.env.MBAPP_JWT_SECRET_B64 || process.env.JWT_SECRET || "";
  const envTxt = process.env.MBAPP_JWT_SECRET || "";
  const sB64 = secretB64 || envB64;
  const sTxt = secretText || envTxt;

  let secret;
  if (sB64) {
    try { secret = Buffer.from(sB64, "base64"); } catch {}
  }
  if (!secret && sTxt) secret = Buffer.from(sTxt, "utf8");
  if (!secret || !secret.length) {
    throw new Error("No HS256 secret. Set MBAPP_JWT_SECRET_B64 (or JWT_SECRET), or MBAPP_JWT_SECRET.");
  }

  const now = Math.floor(Date.now()/1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: userId,
    iss, aud,
    iat: now,
    exp: now + Number(hours)*3600,
    mbapp: { userId, tenantId, roles, policy }
  };
  const data = b64urlJson(header) + "." + b64urlJson(payload);
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  return data + "." + b64url(sig);
}

/** Put token into current process env so subsequent api() calls send it */
export function setBearer(token) {
  process.env.MBAPP_BEARER = token || "";
}

/** Returns a PowerShell line you can eval to set MBAPP_BEARER in your shell */
export function ps1SetEnvLine(token) {
  const safe = String(token).replace(/'/g, "''");
  return `$Env:MBAPP_BEARER = '${safe}'`;
}

/** Persist token so you can '. ops\\.env.ps1' later */
export async function writeTokenFiles(token) {
  const root = process.cwd();
  const outDir = path.join(root, "ops");
  await fs.mkdir(outDir, { recursive: true });
  const ps1Path = path.join(outDir, ".env.ps1");
  const safe = String(token).replace(/'/g, "''");
  await fs.writeFile(ps1Path, `$Env:MBAPP_BEARER = '${safe}'\n`, "utf8");
  return { ps1Path };
}
