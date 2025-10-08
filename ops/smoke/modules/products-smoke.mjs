/* ops/smoke/modules/products-smoke.mjs
 * CRUD + seed for Products
 */
import { rid, withTag, createObject, listObjects, updateObject, deleteObject } from "../core.mjs";

const TYPE = "product";

function scaffold(code) {
  const n = Date.now();
  return {
    type: TYPE,
    id: rid("prod"),
    name: withTag(`Product ${n}`, code),
    sku: withTag(`SKU-${n}`, code),
    kind: "good",
    status: "active",
    // defaultItemId can be fixed up by flows that also create inventory
  };
}

export async function createMany({ each = 1, code } = {}) {
  const ids = [];
  for (let i = 0; i < Number(each); i++) {
    const body = scaffold(code);
    const created = await createObject(TYPE, body);
    ids.push(created.id);
  }
  return { type: TYPE, created: ids };
}

export async function listAll({ limit = 50 } = {}) {
  const page = await listObjects(TYPE, { limit });
  return { type: TYPE, count: (page.items || []).length, items: page.items };
}

export async function updateSome({ limit = 5, code } = {}) {
  const page = await listObjects(TYPE, { limit });
  const patched = [];
  for (const it of page.items || []) {
    const name = withTag(`${it.name || "Product"}`, code);
    const res = await updateObject(TYPE, it.id, { name });
    patched.push(res.id);
  }
  return { type: TYPE, updated: patched.length, ids: patched };
}

export async function deleteAll() {
  let total = 0, next;
  do {
    const page = await listObjects(TYPE, { limit: 50, next });
    for (const it of page.items || []) { await deleteObject(TYPE, it.id); total++; }
    next = page.next;
  } while (next);
  return { type: TYPE, deleted: total };
}
