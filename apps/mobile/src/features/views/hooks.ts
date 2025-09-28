// apps/mobile/src/features/views/hooks.ts
import { useCallback } from "react";
import type { components } from "../../api/generated-types"; // openapi-typescript output

// Config (adjust for your env setup; Expo EXPO_PUBLIC_* suggested)
const API = process.env.EXPO_PUBLIC_API_BASE ?? "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";
const TENANT = process.env.EXPO_PUBLIC_TENANT_ID ?? "DemoTenant";

// If you store the token elsewhere, swap this accessor:
async function getAuthToken(): Promise<string | undefined> {
  return undefined; // e.g., read from SecureStore/AsyncStorage
}

async function getJSON<T>(url: string): Promise<T> {
  const token = await getAuthToken();
  const r = await fetch(url, {
    headers: {
      "content-type": "application/json",
      "x-tenant-id": TENANT,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

// Type from components.schemas (not paths)
export type View = components["schemas"]["View"];
type ListResult<T> = { items: T[]; next?: string | null };

export function useViewsApi() {
  const list = useCallback(
    async (opts?: { moduleKey?: string; ownerId?: string; shared?: boolean; isDefault?: boolean; limit?: number; next?: string }) => {
      const qs = new URLSearchParams();
      if (opts?.moduleKey) qs.set("moduleKey", String(opts.moduleKey));
      if (opts?.ownerId) qs.set("ownerId", String(opts.ownerId));
      if (opts?.shared !== undefined) qs.set("shared", String(opts.shared));
      if (opts?.isDefault !== undefined) qs.set("isDefault", String(opts.isDefault));
      if (opts?.limit) qs.set("limit", String(opts.limit));
      if (opts?.next) qs.set("next", String(opts.next));
      // Your API routes are object-templated:
      const url = `${API}/objects/view/list?${qs.toString()}`;
      return getJSON<ListResult<View>>(url);
    },
    []
  );

  const get = useCallback(async (id: string) => {
    const url = `${API}/objects/view/${encodeURIComponent(id)}`;
    return getJSON<View>(url);
  }, []);

  return { list, get };
}
