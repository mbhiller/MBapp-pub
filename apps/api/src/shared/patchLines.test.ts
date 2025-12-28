// apps/api/src/shared/patchLines.test.ts
// Minimal unit tests for applyPatchLines using Node's assert.

import assert from "node:assert";
import { applyPatchLines, type PatchLineOp } from "./patchLines";

type Line = { id?: string; itemId?: string; qty?: number; uom?: string; cid?: string };

function runTests() {
  // Seed
  const existing: Line[] = [
    { id: "L1", itemId: "A", qty: 1, uom: "ea" },
    { id: "L2", itemId: "B", qty: 2, uom: "ea" },
  ];

  // 1) Update existing (id match)
  {
    const ops: PatchLineOp[] = [{ op: "upsert", id: "L2", patch: { qty: 5, uom: "ea" } }];
    const { lines, summary } = applyPatchLines(existing, ops);
    assert.equal(lines.length, 2, "update should not change length");
    assert.deepEqual(lines[0], { id: "L1", itemId: "A", qty: 1, uom: "ea" });
    assert.deepEqual(lines[1], { id: "L2", itemId: "B", qty: 5, uom: "ea" });
    assert.deepEqual(summary, { added: 0, updated: 1, removed: 0 });
  }

  // 2) Remove existing (by id)
  {
    const ops: PatchLineOp[] = [{ op: "remove", id: "L1" }];
    const { lines, summary } = applyPatchLines(existing, ops);
    assert.equal(lines.length, 1, "remove should reduce length by 1");
    assert.deepEqual(lines[0], { id: "L2", itemId: "B", qty: 2, uom: "ea" });
    assert.deepEqual(summary, { added: 0, updated: 0, removed: 1 });
  }

  // 3) Add new (no id) — do NOT invent id here
  {
    const ops: PatchLineOp[] = [{ op: "upsert", patch: { itemId: "C", qty: 3, uom: "ea" } }];
    const { lines, summary } = applyPatchLines(existing, ops);
    assert.equal(lines.length, 3, "add should increase length by 1");
    assert.deepEqual(lines[0], { id: "L1", itemId: "A", qty: 1, uom: "ea" });
    assert.deepEqual(lines[1], { id: "L2", itemId: "B", qty: 2, uom: "ea" });
    assert.deepEqual(lines[2], { itemId: "C", qty: 3, uom: "ea" });
    assert.deepEqual(summary, { added: 1, updated: 0, removed: 0 });
  }

  // 4) Preserve order: existing order intact; new appended in op order
  {
    const ops: PatchLineOp[] = [
      { op: "upsert", patch: { itemId: "C", qty: 3, uom: "ea" } },
      { op: "upsert", patch: { itemId: "D", qty: 4, uom: "ea" } },
    ];
    const { lines } = applyPatchLines(existing, ops);
    assert.deepEqual(lines.map((l) => l.itemId), ["A", "B", "C", "D"], "order should be existing then appended in op order");
  }

  // 5) Remove by cid (best-effort)
  {
    const withCid: Line[] = [
      { cid: "x1", itemId: "X", qty: 9 },
      { id: "L1", itemId: "A", qty: 1 },
    ];
    const ops: PatchLineOp[] = [{ op: "remove", cid: "x1" }];
    const { lines, summary } = applyPatchLines(withCid, ops);
    assert.equal(lines.length, 1, "cid removal should remove matching line when present");
    assert.deepEqual(lines[0], { id: "L1", itemId: "A", qty: 1 });
    assert.deepEqual(summary, { added: 0, updated: 0, removed: 1 });
  }

  console.log(JSON.stringify({ ok: true, name: "patchLines.test", result: "PASS" }));
}

runTests();
