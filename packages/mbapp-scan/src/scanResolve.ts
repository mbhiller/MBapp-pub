/**
 * Shared scan→item resolution utility.
 * - Classifies inventoryId vs EPC vs QR payload
 * - Delegates EPC lookup to caller-provided resolveEpc fn
 */

import { parseMbappQr } from "./qr";

export type ResolveEpcFn = (epc: string) => Promise<{ itemId: string; status?: string }>;

export type ScanResolution = {
  itemId: string;
  kind: "inventoryId" | "epc" | "qr";
  raw: string;
  status?: string;
};

export type ScanResolutionError = {
  itemId: null;
  kind: "unrecognized" | "network" | "notFound";
  raw: string;
  reason: string;
};

export type ScanResolveResult =
  | { ok: true; value: ScanResolution }
  | { ok: false; error: ScanResolutionError };

export function looksLikeInventoryId(scan: string): boolean {
  const trimmed = scan.trim();
  // Treat as inventory id only if it is uppercase/number/underscore/hyphen, not EPC-prefixed.
  return /^[A-Z0-9][A-Z0-9_-]{2,}$/.test(trimmed) && !/^EPC/i.test(trimmed) && !/^URN:EPC/i.test(trimmed);
}

export function looksLikeEpc(scan: string): boolean {
  const trimmed = scan.trim();
  if (!trimmed) return false;
  const upper = trimmed.toUpperCase();
  if (upper.startsWith("EPC")) return true; // includes EPCTEST-
  if (upper.startsWith("URN:EPC:")) return true;
  return /^\d{13,}$/.test(trimmed) || /^[0-9a-fA-F]{14,}$/.test(trimmed);
}

export async function resolveScan(
  scan: string,
  deps: { resolveEpc: ResolveEpcFn }
): Promise<ScanResolveResult> {
  const raw = String(scan || "").trim();

  if (!raw) {
    return { ok: false, error: { itemId: null, kind: "unrecognized", raw, reason: "Empty scan" } };
  }

  if (looksLikeEpc(raw)) {
    try {
      const result = await deps.resolveEpc(raw);
      return { ok: true, value: { itemId: result.itemId, status: result.status, kind: "epc", raw } };
    } catch (err: any) {
      const notFound = err instanceof Error && err.message === "EPC not found";
      return {
        ok: false,
        error: {
          itemId: null,
          kind: notFound ? "notFound" : "network",
          raw,
          reason: notFound ? "EPC not found" : "EPC lookup failed",
        },
      };
    }
  }

  if (looksLikeInventoryId(raw)) {
    return { ok: true, value: { itemId: raw, kind: "inventoryId", raw } };
  }

  const qr = parseMbappQr(raw);
  if (qr && qr.id) {
    return { ok: true, value: { itemId: qr.id, kind: "qr", raw } };
  }

  return {
    ok: false,
    error: { itemId: null, kind: "unrecognized", raw, reason: "Scan does not match inventory ID, EPC, or QR format" },
  };
}
