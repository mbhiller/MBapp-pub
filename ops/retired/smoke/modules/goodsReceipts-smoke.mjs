/* ops/smoke/modules/goodsReceipts-smoke.mjs */
import { listObjects, deleteObject } from "../core.mjs";

const TYPE = "goodsReceipt";

export async function listAll({ limit = 50 } = {}) {
  let items = [], next;
  do {
    const page = await listObjects(TYPE, { limit, next });
    items = items.concat(page.items || []);
    next = page.next;
  } while (next);
  return items;
}

export async function deleteAll() {
  const items = await listAll();
  for (const it of items) await deleteObject(TYPE, it.id);
  return { type: TYPE, deleted: items.length };
}
