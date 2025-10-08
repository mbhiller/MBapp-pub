/* ops/smoke/core.mjs */
import process from "node:process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const API_BASE = (process.env.MBAPP_API_BASE || "").replace(/\/+$/, "");
export let BEARER = process.env.MBAPP_BEARER || "";
export const TENANT = process.env.MBAPP_TENANT_ID || undefined;

function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");
}
function b64urlJson(obj) { return b64url(Buffer.from(JSON.stringify(obj))); }

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
  // secret: prefer base64, fallback to raw text env
  const sB64 = secretB64 || process.env.MBAPP_JWT_SECRET_B64 || "";
  const sTxt = secretText || process.env.MBAPP_JWT_SECRET || "";
  let secret;
  if (sB64) {
    try { secret = Buffer.from(sB64, "base64"); } catch { /* noop */ }
  }
  if (!secret) secret = Buffer.from(sTxt, "utf8");
  if (!secret || !secret.length) {
    throw new Error("No HS256 secret provided. Set MBAPP_JWT_SECRET_B64 or MBAPP_JWT_SECRET, or pass --secret-b64/--secret.");
  }

  const now = Math.floor(Date.now()/1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: userId,
    iss, aud,
    iat: now,
    exp: now + Number(hours)*3600,
    mbapp: {
      userId,
      tenantId,
      roles,
      policy
    }
  };
  const data = b64urlJson(header) + "." + b64urlJson(payload);
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  return data + "." + b64url(sig);
}

export function requireEnv() {
  if (!API_BASE) throw new Error("MBAPP_API_BASE not set");
  if (!BEARER) throw new Error("MBAPP_BEARER not set (use --token or run: node ops/smoke.mjs login --token <JWT>)");
}

export function setBearer(token) {
  BEARER = token || "";
  process.env.MBAPP_BEARER = BEARER;
}

export async function writeTokenFiles(token) {
  const root = process.cwd();
  const outDir = path.join(root, "ops");
  await fs.mkdir(outDir, { recursive: true });
  const tokenPath = path.join(outDir, ".mb_bearer");
  const ps1Path = path.join(outDir, ".env.ps1");
  const safe = String(token).replace(/'/g, "''");
  await fs.writeFile(tokenPath, token, "utf8");
  await fs.writeFile(ps1Path, `$env:MBAPP_BEARER = '${safe}'\n`, "utf8");
  return { tokenPath, ps1Path };
}

export function ps1SetEnvLine(token) {
  const safe = String(token).replace(/'/g, "''");
  return `$env:MBAPP_BEARER = '${safe}'`;
}

export async function api(path, { method = "GET", body, headers } = {}) {
  requireEnv();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "authorization": `Bearer ${BEARER}`,
      "content-type": "application/json",
      ...(TENANT ? { "x-tenant-id": TENANT } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.message || text || res.statusText;
    const rid = res.headers.get("x-amzn-RequestId") || res.headers.get("x-request-id") || "";
    const hdr = Object.fromEntries([...res.headers.entries()]);
    const err = new Error(`HTTP ${res.status} ${res.statusText} ${path} — ${msg}\nheaders=${JSON.stringify(hdr)}\nbody=${text}\nrequestId=${rid}`);
    err.status = res.status;
    err.response = json;
    throw err;
  }
  return json;
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const nowIso = () => new Date().toISOString();
export const rid = (p="id") => `${p}_${Math.random().toString(36).slice(2,10)}`;

export function withTag(str, code) {
  return code ? `${String(str)}-${String(code)}` : String(str);
}

// Generic Objects API wrappers
export async function createObject(type, body) { return api(`/objects/${encodeURIComponent(type)}`, { method: "POST", body }); }
export async function updateObject(type, id, patch) { return api(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: "PUT", body: patch }); }
export async function deleteObject(type, id) { return api(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: "DELETE" }); }
export async function getObject(type, id) { return api(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: "GET" }); }
export async function listObjects(type, { limit = 50, next } = {}) {
  const q = new URLSearchParams();
  q.set("limit", String(limit));
  if (next) q.set("next", String(next));
  const res = await api(`/objects/${encodeURIComponent(type)}?${q.toString()}`, { method: "GET" });
  if (Array.isArray(res)) return { items: res };
  if (res && typeof res === "object" && "items" in res) return res;
  return { items: [], raw: res };
}
