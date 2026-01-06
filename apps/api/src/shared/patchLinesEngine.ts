// apps/api/src/shared/patchLinesEngine.ts
// Shared orchestration + validation for patch-lines handlers (SO/PO).
import { applyPatchLines, type PatchLineOp } from "./patchLines";
import { ensureLineIds } from "./ensureLineIds";
import { lineKey } from "./lineKey";

export class PatchLinesValidationError extends Error {
  code: string;
  statusCode?: number;
  details?: Record<string, unknown>;
  constructor(message: string, code = "PATCH_LINES_INVALID", details?: Record<string, unknown>, statusCode?: number) {
    super(message);
    this.name = "PatchLinesValidationError";
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

export type PatchLinesEngineOptions = {
  entityLabel: "salesOrder" | "purchaseOrder" | string;
  editableStatuses: readonly string[];
  patchableFields: readonly string[];
};

export type PatchLinesEngineInput<T extends { id?: string; cid?: string }> = {
  currentDoc: { status?: string; lines?: T[] };
  ops: PatchLineOp[];
  options: PatchLinesEngineOptions;
};

export type PatchLinesEngineResult<T> = {
  nextLines: T[];
  summary: { added: number; updated: number; removed: number };
};

const isNonEmptyString = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;
const trimMaybe = (s: unknown): string | undefined => (typeof s === "string" ? s.trim() : undefined);

function validateStatus(status: string | undefined, editableStatuses: readonly string[], entityLabel: string) {
  const normalized = (status || "").toLowerCase();
  const allowed = editableStatuses.map((s) => s.toLowerCase());
  if (!allowed.includes(normalized)) {
    const baseLabel = entityLabel.toLowerCase();
    const code = baseLabel.includes("sales")
      ? "SO_NOT_EDITABLE"
      : baseLabel.includes("purchase")
      ? "PO_NOT_EDITABLE"
      : `${entityLabel.toUpperCase()}_NOT_EDITABLE`;
    throw new PatchLinesValidationError(
      `${entityLabel} not editable in current status`,
      code,
      { status },
      409
    );
  }
}

function validateAndNormalizeOps(ops: PatchLineOp[], patchableFields: readonly string[]): PatchLineOp[] {
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new PatchLinesValidationError("Body must include non-empty ops[]", "PATCH_LINES_INVALID_BODY");
  }

  const fieldSet = new Set(patchableFields);
  const normalizedOps: PatchLineOp[] = [];

  for (const rawOp of ops) {
    if (!rawOp || typeof rawOp !== "object") {
      throw new PatchLinesValidationError("Each op must be an object", "PATCH_LINES_INVALID_OP");
    }

    const op = (rawOp as any).op;
    if (op !== "upsert" && op !== "remove") {
      throw new PatchLinesValidationError("op must be upsert or remove", "PATCH_LINES_INVALID_OP");
    }

    const id = trimMaybe((rawOp as any).id);
    const cid = trimMaybe((rawOp as any).cid);
    const patch = (rawOp as any).patch;

    if (id && id.startsWith("tmp-")) {
      throw new PatchLinesValidationError("id cannot start with tmp- (reserved for cid)", "PATCH_LINES_INVALID_ID", { id });
    }

    if (op === "remove") {
      if (!isNonEmptyString(id)) {
        throw new PatchLinesValidationError("remove op requires id", "PATCH_LINES_REMOVE_REQUIRES_ID");
      }
      if (cid || typeof patch !== "undefined") {
        throw new PatchLinesValidationError("remove op forbids cid or patch", "PATCH_LINES_REMOVE_SHAPE");
      }
      normalizedOps.push({ op: "remove", id });
      continue;
    }

    // upsert
    if (!isNonEmptyString(id) && !isNonEmptyString(cid)) {
      throw new PatchLinesValidationError("upsert op requires id or cid", "PATCH_LINES_UPSERT_REQUIRES_KEY");
    }

    if (cid && !cid.startsWith("tmp-")) {
      throw new PatchLinesValidationError("cid must start with tmp-", "PATCH_LINES_INVALID_CID", { cid });
    }

    if (typeof patch !== "object" || patch === null) {
      throw new PatchLinesValidationError("upsert op requires patch object", "PATCH_LINES_UPSERT_REQUIRES_PATCH");
    }

    const allowedPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!fieldSet.has(k)) {
        throw new PatchLinesValidationError("patch contains non-patchable field", "PATCH_LINES_INVALID_FIELD", { field: k });
      }
      allowedPatch[k] = v;
    }

    if (Object.keys(allowedPatch).length === 0) {
      throw new PatchLinesValidationError("upsert patch must include at least one patchable field", "PATCH_LINES_EMPTY_PATCH");
    }

    const normalized: PatchLineOp = { op: "upsert", patch: allowedPatch };
    if (id) normalized.id = id;
    if (!id && cid) normalized.cid = cid;
    if (id && cid) normalized.cid = cid; // cid optional for existing, but keep if provided
    normalizedOps.push(normalized);
  }

  return normalizedOps;
}

function collectReservedIds<T extends { id?: string; cid?: string }>(beforeLines: T[], afterLines: T[]): { reserveIds: string[]; maxCounter: number } {
  const beforeKeys = new Set<string>(beforeLines.map((l) => lineKey(l)).filter((k) => k !== null) as string[]);
  const afterKeys = new Set<string>(afterLines.map((l) => lineKey(l)).filter((k) => k !== null) as string[]);

  // Collect ids that were removed (in before but not in after)
  const removedIds: string[] = [];
  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) {
      // Only reserve server-assigned L{n} ids; client-only tmp-* ids are ephemeral
      if (/^L\d+$/.test(key)) {
        removedIds.push(key);
      }
    }
  }

  // Find max L{n} counter to avoid reuse
  let maxCounter = 0;
  for (const key of beforeKeys) {
    const match = /^L(\d+)$/.exec(key);
    if (match) {
      const n = Number(match[1]);
      if (!Number.isNaN(n)) maxCounter = Math.max(maxCounter, n);
    }
  }
  for (const key of afterKeys) {
    const match = /^L(\d+)$/.exec(key);
    if (match) {
      const n = Number(match[1]);
      if (!Number.isNaN(n)) maxCounter = Math.max(maxCounter, n);
    }
  }
  for (const id of removedIds) {
    const match = /^L(\d+)$/.exec(id);
    if (match) {
      const n = Number(match[1]);
      if (!Number.isNaN(n)) maxCounter = Math.max(maxCounter, n);
    }
  }

  return { reserveIds: removedIds, maxCounter };
}

export function runPatchLinesEngine<T extends { id?: string; cid?: string; [k: string]: any }>(
  input: PatchLinesEngineInput<T>
): PatchLinesEngineResult<T> {
  const { currentDoc, ops, options } = input;
  validateStatus(currentDoc.status, options.editableStatuses, options.entityLabel);

  const normalizedOps = validateAndNormalizeOps(ops, options.patchableFields);

  const beforeLines: T[] = Array.isArray(currentDoc.lines) ? [...(currentDoc.lines as T[])] : [];
  const { lines: patchedLines, summary } = applyPatchLines<T>(beforeLines, normalizedOps);

  const { reserveIds, maxCounter } = collectReservedIds(beforeLines, patchedLines);
  const withIds = ensureLineIds<T>(patchedLines, { reserveIds, startAt: maxCounter + 1 }) as T[];

  return { nextLines: withIds, summary };
}
