#!/usr/bin/env node
import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";

const API_BASE = process.env.MBAPP_API_BASE;
const BEARER   = process.env.MBAPP_BEARER;

if (!API_BASE) {
  console.error("MBAPP_API_BASE not set");
  process.exit(2);
}
if (!BEARER) {
  console.error("MBAPP_BEARER not set (run your login step first)");
  process.exit(2);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "authorization": `Bearer ${BEARER}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${res.statusText} — ${text}`);
  }
  return json;
}

async function listType(type, limit=200, next) {
  const q = new URLSearchParams({ type, limit: String(limit) });
  if (next) q.set("next", next);
  return api(`/tools/gc/${encodeURIComponent(type)}?${q.toString()}`, { method: "GET" });
}

async function deleteType(type, limit=200) {
  let total = 0, next;
  do {
    const page = await listType(type, limit, next);
    const keys = (page.items || []).map(k => ({ pk: k.pk, sk: k.sk }));
    if (keys.length) {
      const del = await api(`/tools/gc/delete-keys`, { method: "POST", body: { keys } });
      total += del.deleted || 0;
      // small spacing to avoid throttling
      await wait(50);
    }
    next = page.next;
  } while (next);
  return { type, deleted: total };
}

async function listAll(limit=500, next) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (next) q.set("next", next);
  return api(`/tools/gc/list-all?${q.toString()}`, { method: "GET" });
}

async function deleteKeysFromFile(filePath) {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(filePath, "utf8");
  const keys = JSON.parse(raw);
  if (!Array.isArray(keys)) throw new Error("File must contain an array of { pk, sk }");
  return api(`/tools/gc/delete-keys`, { method: "POST", body: { keys } });
}

/* ---------- CLI ---------- */
const [, , cmd, ...args] = process.argv;

async function main() {
  switch (cmd) {
    case "list:type": {
      const type = args[0];
      if (!type) throw new Error("Usage: node ops/tools/gc/gc.mjs list:type <type>");
      const out = await listType(type);
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    case "delete:type": {
      const type = args[0];
      if (!type) throw new Error("Usage: node ops/tools/gc/gc.mjs delete:type <type>");
      const out = await deleteType(type);
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    case "list:all": {
      const out = await listAll();
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    case "delete:keys": {
      const file = args[0];
      if (!file) throw new Error("Usage: node ops/tools/gc/gc.mjs delete:keys <file.json>");
      const out = await deleteKeysFromFile(file);
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    default:
      console.log(`Usage:
  node ops/tools/gc/gc.mjs list:type <type>
  node ops/tools/gc/gc.mjs delete:type <type>
  node ops/tools/gc/gc.mjs list:all
  node ops/tools/gc/gc.mjs delete:keys <file.json>`);
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
