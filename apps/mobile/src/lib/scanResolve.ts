/**
 * Shared scan→item resolution utility for mobile.
 * Handles QR/barcode/EPC scans and maps them to itemId.
 */

import { parseMbappQr } from "./qr";
import { resolveEpc } from "../features/_shared/epc";

export type ScanResolution = {
  itemId: string;
  kind: "inventoryId" | "epc" | "qr";
  raw: string;
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

/**
 * Type guard: check if a string looks like an inventory ID.
 * Inventory IDs are typically alphanumeric with hyphens (e.g., "INV-001", "ITEM-ABC-123").
 */
function looksLikeInventoryId(scan: string): boolean {
  // Simple heuristic: if it contains only uppercase letters, numbers, and hyphens, treat as inventory ID
  return /^[A-Z0-9\-]+$/.test(scan);
}

/**
 * Type guard: check if a string looks like an EPC.
 * EPCs are typically long numeric strings (e.g., 96-bit SGTIN = 18+ digits) or hex patterns.
 */
function looksLikeEpc(scan: string): boolean {
  const trimmed = scan.trim();
  // EPC: 13+ digits, or hex-like pattern (starts with digit, mostly hex chars)
  return /^\d{13,}$/.test(trimmed) || /^[0-9a-fA-F]{14,}$/.test(trimmed);
}

/**
 * Resolve a scan (QR/barcode/EPC) to an itemId.
 *
 * Resolution order:
 * 1. If scan looks like an inventory ID, return it as itemId.
 * 2. If scan looks like an EPC, call EPC resolve API.
 * 3. If scan parses as QR payload, extract itemId.
 * 4. Otherwise, return error with reason.
 *
 * @param scan - Raw string from camera scan.
 * @returns Promise<ScanResolveResult>
 */
export async function resolveScan(
  scan: string
): Promise<ScanResolveResult> {
  const raw = String(scan || "").trim();

  if (!raw) {
    return {
      ok: false,
      error: {
        itemId: null,
        kind: "unrecognized",
        raw,
        reason: "Empty scan",
      },
    };
  }

  // Step 1: Check if it looks like an inventory ID (uppercase + hyphens)
  if (looksLikeInventoryId(raw)) {
    return {
      ok: true,
      value: {
        itemId: raw,
        kind: "inventoryId",
        raw,
      },
    };
  }

  // Step 2: Check if it looks like an EPC and try to resolve
  if (looksLikeEpc(raw)) {
    try {
      const result = await resolveEpc(raw);
      return {
        ok: true,
        value: {
          itemId: result.itemId,
          kind: "epc",
          raw,
        },
      };
    } catch (err) {
      const reason =
        err instanceof Error && err.message === "EPC not found"
          ? "EPC not found"
          : "EPC lookup failed";
      const kind =
        err instanceof Error && err.message === "EPC not found"
          ? "notFound"
          : "network";
      return {
        ok: false,
        error: {
          itemId: null,
          kind,
          raw,
          reason,
        },
      };
    }
  }

  // Step 3: Try to parse as QR payload
  const qr = parseMbappQr(raw);
  if (qr && qr.id) {
    return {
      ok: true,
      value: {
        itemId: qr.id,
        kind: "qr",
        raw,
      },
    };
  }

  // Step 4: Unrecognized
  return {
    ok: false,
    error: {
      itemId: null,
      kind: "unrecognized",
      raw,
      reason: "Scan does not match inventory ID, EPC, or QR format",
    },
  };
}
