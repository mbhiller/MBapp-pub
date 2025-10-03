// apps/mobile/src/features/workspaces/hooks.ts
import { useCallback } from "react";
import type { components } from "../../api/generated-types";

const API = process.env.EXPO_PUBLIC_API_BASE ?? "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com";
const TENANT = process.env.EXPO_PUBLIC_TENANT_ID ?? "DemoTenant";

async function getAuthToken(): Promise<string | undefined> {
  return undefined;
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

// Type from components.schemas
export type Workspace = components["schemas"]["Workspace"];
type ListResult<T> = { items: T[]; next?: string | null };

export function useWorkspacesApi() {
  const list = useCallback(
    async (opts?: { ownerId?: string; shared?: boolean; limit?: number; next?: string }) => {
      const qs = new URLSearchParams();
      if (opts?.ownerId) qs.set("ownerId", String(opts.ownerId));
      if (opts?.shared !== undefined) qs.set("shared", String(opts.shared));
      if (opts?.limit) qs.set("limit", String(opts.limit));
      if (opts?.next) qs.set("next", String(opts.next));
      const url = `${API}/objects/workspace/list?${qs.toString()}`;
      return getJSON<ListResult<Workspace>>(url);
    },
    []
  );

  const get = useCallback(async (id: string) => {
    const url = `${API}/objects/workspace/${encodeURIComponent(id)}`;
    return getJSON<Workspace>(url);
  }, []);

  return { list, get };
}
