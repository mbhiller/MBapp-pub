// apps/mobile/src/features/_shared/epc.ts
import { apiClient } from "../../api/client";

export async function resolveEpc(epc: string): Promise<{ itemId: string; status?: string }> {
  const tag = String(epc || "").trim();
  if (!tag) throw new Error("Empty code");
  const res = await apiClient.get<{ itemId: string; status?: string }>(`/epc/resolve?epc=${encodeURIComponent(tag)}`);
  if (!res?.itemId) throw new Error("EPC not found");
  return res;
}
