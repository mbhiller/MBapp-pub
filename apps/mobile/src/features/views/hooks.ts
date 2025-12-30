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
    async (opts?: { entityType?: string; q?: string; limit?: number; nextToken?: string }) => {
      const qs = new URLSearchParams();
      if (opts?.entityType) qs.set("entityType", String(opts.entityType));
      if (opts?.q) qs.set("q", String(opts.q));
      if (opts?.limit) qs.set("limit", String(opts.limit));
      if (opts?.nextToken) qs.set("nextToken", String(opts.nextToken));
      // Spec-compliant endpoint (Sprint Q alignment):
      const url = `${API}/views?${qs.toString()}`;
      return getJSON<ListResult<View>>(url);
    },
    []
  );

  const get = useCallback(async (id: string) => {
    // Spec-compliant endpoint (Sprint Q alignment):
    const url = `${API}/views/${encodeURIComponent(id)}`;
    return getJSON<View>(url);
  }, []);

  return { list, get };
}
