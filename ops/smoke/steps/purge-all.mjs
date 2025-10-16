import { api, normalizePage } from "../core.mjs";
const TYPES = ["salesOrder","purchaseOrder","partyRole","customerAccount","vendorAccount","party","product","inventoryItem","laborEntry","payrollBatch","leaseAgreement","leaseBillingRun"];
async function listAll(type) {
  let next, out = [];
  do {
    const qs = next ? `?next=${encodeURIComponent(next)}` : "";
    const page = await api(`/objects/${encodeURIComponent(type)}${qs}`, { method: "GET" });
    const { items, next: nx } = normalizePage(page);
    out.push(...items);
    next = nx;
  } while (next);
  return out;
}
export async function run() {
  const deleted = [];
  for (const type of TYPES) {
    try {
      const items = await listAll(type);
      for (const it of items) {
        if (!it?.id) continue;
        await api(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(it.id)}`, { method: "DELETE" });
        deleted.push({ type, id: it.id });
      }
    } catch (e) {
      deleted.push({ type, error: e?.message || String(e) });
    }
  }
  return { action: "purge:all", deletedCount: deleted.length, deleted };
}
