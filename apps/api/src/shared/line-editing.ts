// apps/api/src/shared/line-editing.ts
// Shared wrapper for "apply patch + ensureLineIds" pattern (SO/PO patch-lines handlers).

import { runPatchLinesEngine, type PatchLinesEngineOptions, type PatchLinesEngineInput } from "./patchLinesEngine";
import { ensureLineIds } from "./ensureLineIds";
import type { PatchLineOp } from "./patchLines";

export type LinePatchResult<T> = {
  lines: T[];
  summary: { added: number; updated: number; removed: number };
};

/**
 * Apply patch operations to lines and ensure stable ids.
 * - Validates document status against editableStatuses
 * - Applies patch operations (upsert, remove)
 * - Assigns stable L{n} ids to lines missing them
 * - Reserves removed line ids to avoid reuse
 *
 * @param currentDoc Document with status and lines
 * @param ops Patch operations to apply
 * @param options Validation + patching config (entityLabel, editableStatuses, patchableFields)
 * @returns { lines: normalized lines with ids, summary: counts of added/updated/removed }
 */
export function applyPatchLinesAndEnsureIds<T extends { id?: string; cid?: string; [k: string]: any }>(
  currentDoc: { status?: string; lines?: T[] },
  ops: PatchLineOp[],
  options: PatchLinesEngineOptions,
): LinePatchResult<T> {
  const { nextLines, summary } = runPatchLinesEngine<T>({ currentDoc, ops, options });

  // nextLines are already normalized with ids by runPatchLinesEngine,
  // but defensive ensureLineIds for extra safety and consistency.
  // This is a belt-and-suspenders approach: engine has reserved ids + assigned new ones,
  // but we ensure again here to guarantee invariant before save.
  const normalizedLines = ensureLineIds(nextLines) as T[];

  return { lines: normalizedLines, summary };
}
