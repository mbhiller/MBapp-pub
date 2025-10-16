import { api } from "../core.mjs";
export async function run(ctx = {}) {
  const itemId = ctx.itemId || process.env.SMOKE_ITEM_ID || process.env.SMOKE_ITEM;
  if (!itemId) throw new Error("Missing itemId (pass ctx.itemId or set SMOKE_ITEM_ID)");
  const onhand = await api(`/inventory/${encodeURIComponent(itemId)}/onhand`);
  let debug = null;
  try { debug = await api(`/inventory/${encodeURIComponent(itemId)}/debug`); } catch (_) {}
  return { itemId, onhand, debug };
}
