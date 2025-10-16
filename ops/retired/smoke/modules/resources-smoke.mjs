/* CRUD helpers for resource */
import { createObject, listObjects, deleteObject, rid, withTag } from "../core.mjs";

const TYPE = "resource";

export async function createMany({ each = 3, code = "res", kind = "stall" } = {}) {
  const created = [];
  for (let i = 0; i < each; i++) {
    const id = rid("res");
    const name = `${kind.toUpperCase()}-${i + 1}`;
    const obj = await createObject(TYPE, {
      type: TYPE,
      id,
      name,
      resourceType: kind,              // map to schema values if different
      status: "available",
      capacity: kind === "arena" ? 10 : 1,
      tags: [withTag(kind, code)],
      notes: withTag("seeded", code),
    });
    created.push(obj.id);
  }
  return { type: TYPE, ids: created, created };
}

export async function listAll({ limit = 200 } = {}) {
  let items = [], next;
  do {
    const page = await listObjects(TYPE, { limit: 50, next, by: "updatedAt", sort: "desc" });
    items = items.concat(page.items || []);
    next = page.next;
  } while (next && items.length < limit);
  return items;
}

export async function deleteAll() {
  const items = await listAll();
  for (const it of items) await deleteObject(TYPE, it.id);
  return { type: TYPE, deleted: items.length };
}
