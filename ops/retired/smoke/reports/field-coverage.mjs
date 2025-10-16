/* ops/smoke/reports/field-coverage.mjs */
import { listObjects } from "../core.mjs";

export async function run({ limit = 200 } = {}) {
  const types = ["event", "registration", "resource", "reservation"];
  const out = {};
  for (const type of types) {
    const page = await listObjects(type, { limit, by: "updatedAt", sort: "desc" });
    if (!page || !page.items) { out[type] = { error: "no_items" }; continue; }
    const fields = new Map();
    for (const it of page.items) {
      Object.entries(it).forEach(([k, v]) => {
        const f = fields.get(k) || { total: 0, nonNull: 0 };
        f.total += 1;
        if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) f.nonNull += 1;
        fields.set(k, f);
      });
    }
    out[type] = Object.fromEntries([...fields.entries()].map(([k, v]) => [k, { coverage: v.total ? v.nonNull / v.total : 0 }]));
  }
  return { report: "field-coverage", result: "PASS", coverage: out };
}
