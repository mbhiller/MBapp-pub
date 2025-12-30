// apps/mobile/src/features/views/hooks.ts
import { useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { components } from "../../api/generated-types"; // openapi-typescript output

// Config (adjust for your env setup; Expo EXPO_PUBLIC_* suggested)
const API = process.env.EXPO_PUBLIC_API_BASE ?? "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";
const TENANT = process.env.EXPO_PUBLIC_TENANT_ID ?? "DemoTenant";
const TOKEN_KEY = "mbapp.dev.token";

// Retrieve bearer token from AsyncStorage (matches DevAuthBootstrap storage)
async function getAuthToken(): Promise<string | undefined> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    return token || undefined;
  } catch {
    return undefined;
  }
}

async function getJSON<T>(url: string, method: "GET" | "POST" | "PATCH" = "GET", body?: any): Promise<T> {
  const token = await getAuthToken();
  const r = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-tenant-id": TENANT,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

// Type from components.schemas (not paths)
export type View = components["schemas"]["View"];
type ListResult<T> = { items: T[]; next?: string | null };

type CreateViewPayload = {
  name: string;
  entityType: string;
  filters?: Array<{ field: string; op: string; value: any }>;
  sort?: { field: string; dir?: "asc" | "desc" };
  description?: string;
  shared?: boolean;
};

type PatchViewPayload = Partial<CreateViewPayload>;

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
      return getJSON<ListResult<View>>(url, "GET");
    },
    []
  );

  const get = useCallback(async (id: string) => {
    // Spec-compliant endpoint (Sprint Q alignment):
    const url = `${API}/views/${encodeURIComponent(id)}`;
    return getJSON<View>(url, "GET");
  }, []);

  const create = useCallback(async (payload: CreateViewPayload) => {
    const url = `${API}/views`;
    return getJSON<View>(url, "POST", payload);
  }, []);

  const patch = useCallback(async (id: string, payload: PatchViewPayload) => {
    const url = `${API}/views/${encodeURIComponent(id)}`;
    return getJSON<View>(url, "PATCH", payload);
  }, []);

  return { list, get, create, patch };
}
