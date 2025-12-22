// apps/mobile/src/features/purchasing/poActions.ts
import { apiClient } from "../../api/client";

export async function saveFromSuggestion(draftOrDrafts: any | any[]) {
  const body = Array.isArray(draftOrDrafts) ? { drafts: draftOrDrafts } : { draft: draftOrDrafts };
  // returns { id?: string, ids: string[] }
  return apiClient.post(`/purchasing/po:create-from-suggestion`, body);
}

export async function submit(poId: string) {
  const res = await apiClient.post(`/purchasing/po/${encodeURIComponent(poId)}:submit`, {});
  return (res as any)?.body ?? res;
}

export async function approve(poId: string) {
  const res = await apiClient.post(`/purchasing/po/${encodeURIComponent(poId)}:approve`, {});
  return (res as any)?.body ?? res;
}

export async function cancel(poId: string) {
  const res = await apiClient.post(`/purchasing/po/${encodeURIComponent(poId)}:cancel`, {});
  return (res as any)?.body ?? res;
}

export async function close(poId: string) {
  const res = await apiClient.post(`/purchasing/po/${encodeURIComponent(poId)}:close`, {});
  return (res as any)?.body ?? res;
}

export async function receiveAll(poSnap: any) {
  const rem = (ln: any) => Math.max(0, Number(ln?.qty ?? 0) - Number(ln?.receivedQty ?? 0));
  const lines = (poSnap?.lines ?? [])
    .map((ln: any) => ({ lineId: String(ln.id ?? ln.lineId), deltaQty: rem(ln) }))
    .filter((x: any) => x.deltaQty > 0);
  if (!poSnap?.id || lines.length === 0) return { ok: true, noop: true };
  return apiClient.post(`/purchasing/po/${encodeURIComponent(poSnap.id)}:receive`, { lines });
}

// --- Sprint H helpers (centralized receive mutations) ---
export type ReceiveLine = {
  lineId: string;
  deltaQty: number;
  lot?: string;
  locationId?: string;
};

export async function receiveLines(
  poId: string,
  lines: ReceiveLine[],
  opts?: { idempotencyKey?: string }
) {
  if (!poId) throw new Error("poId required");
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("lines[] required");
  const headers = opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined;
  return apiClient.post(`/purchasing/po/${encodeURIComponent(poId)}:receive`, { lines }, headers);
}

export async function receiveLine(
  poId: string,
  line: ReceiveLine,
  opts?: { idempotencyKey?: string }
) {
  return receiveLines(poId, [line], opts);
}