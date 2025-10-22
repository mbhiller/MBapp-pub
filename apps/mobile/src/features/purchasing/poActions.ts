// apps/mobile/src/features/purchasing/poActions.ts
import { apiClient } from "../../api/client";

export async function saveFromSuggestion(draftOrDrafts: any | any[]) {
  const body = Array.isArray(draftOrDrafts) ? { drafts: draftOrDrafts } : { draft: draftOrDrafts };
  // returns { id?: string, ids: string[] }
  return apiClient.post(`/purchasing/po:create-from-suggestion`, body);
}

export async function receiveAll(poSnap: any) {
  const rem = (ln: any) => Math.max(0, Number(ln?.qty ?? 0) - Number(ln?.receivedQty ?? 0));
  const lines = (poSnap?.lines ?? [])
    .map((ln: any) => ({ lineId: String(ln.id ?? ln.lineId), deltaQty: rem(ln) }))
    .filter((x: any) => x.deltaQty > 0);
  if (!poSnap?.id || lines.length === 0) return { ok: true, noop: true };
  return apiClient.post(`/purchasing/po/${encodeURIComponent(poSnap.id)}:receive`, { lines });
}
