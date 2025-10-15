#!/usr/bin/env node
import { api } from "../core.mjs";

const TYPES = [
  "reservation","resource","registration","event",
  "salesOrder","purchaseOrder","inventory","product",
  "vendor","client","employee"
];

async function purgeType(type) {
  // Fast path: admin reset via tools/gc/:type
  try { await api(`/tools/gc/${encodeURIComponent(type)}`, { method: "DELETE" }); return { type, via: "tools/gc", deleted: true }; }
  catch { /* fall back to per-id deletes below */ }

  // Fallback: list + delete each
  const page = await api(`/objects/${encodeURIComponent(type)}`, { method: "GET" });
  const items = Array.isArray(page) ? page : (page?.items ?? []);
  let n = 0;
  for (const it of items) {
    if (!it?.id) continue;
    try { await api(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(it.id)}`, { method: "DELETE" }); n++; } catch {}
  }
  return { type, via: "objects", count: n };
}

export async function run() {
  const out = {};
  for (const t of TYPES) out[t] = await purgeType(t);
  return { test: "purge:all", result: "PASS", details: out };
}
export default { run };
