// apps/mobile/src/features/_shared/useObjects.ts
// Canonical hook for both single-object and list fetching.
// List mode ALWAYS returns { items: T[]; total?: number }.
// Single mode returns object T.
// State shape is { data, isLoading, error, refetch } for both modes.

import * as React from "react";
import { apiClient } from "../../api/client";

export type SingleArgs = {
  type: string;
  id?: string;                // presence of id (truthy) => single mode
  select?: (x: any) => any;
  enabled?: boolean;
};

export type ListArgs = {
  type: string;
  q?: string;
  filter?: Record<string, any>;
  query?: Record<string, any>;
  params?: Record<string, any>;
  select?: (x: any) => any;
  enabled?: boolean;
};

export type UseObjectsArgs = SingleArgs | ListArgs;
export type ListResult<T> = { items: T[]; total?: number };

type BaseState<T> = {
  data: T | undefined;
  isLoading: boolean;
  error: any;
  refetch: () => Promise<void>;
};

function buildQS(
  q?: string,
  filter?: Record<string, any>,
  query?: Record<string, any>,
  params?: Record<string, any>
) {
  const qp = new URLSearchParams();
  const add = (obj?: Record<string, any>, prefix?: string) => {
    if (!obj) return;
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      qp.set(prefix ? `${prefix}.${k}` : k, String(v));
    }
  };
  if (q != null && q !== "") qp.set("q", String(q));
  add(filter, "filter");
  add(query);
  add(params);
  const qs = qp.toString();
  return qs ? `?${qs}` : "";
}

async function fetchSingle(type: string, id: string) {
  const res = await apiClient.get(`/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
  return (res as any).body ?? res;
}

async function fetchList(
  type: string,
  q?: string,
  filter?: Record<string, any>,
  query?: Record<string, any>,
  params?: Record<string, any>
): Promise<ListResult<any>> {
  const qs = buildQS(q, filter, query, params);
  const res = await apiClient.get(`/objects/${encodeURIComponent(type)}${qs}`);
  const raw = (res as any).body ?? res;

  // Normalize common server shapes -> { items, total? }
  if (Array.isArray(raw?.items)) return { items: raw.items, total: (raw as any).total };
  if (Array.isArray(raw)) return { items: raw };
  if (Array.isArray(raw?.data)) return { items: raw.data, total: (raw as any).total };
  if (raw?.pages) {
    const items = (raw.pages as any[])?.flatMap((p: any) => p?.items ?? []) ?? [];
    return { items, total: (raw as any).total };
  }
  return { items: raw ? [raw] : [] };
}

// Overloads so TS infers the right data shape at call sites
export function useObjects<T = any>(args: SingleArgs): BaseState<T>;
export function useObjects<T = any>(args: ListArgs): BaseState<ListResult<T>>;
// Fallback for cases where id is possibly undefined from routing
export function useObjects<T = any>(args: { type: string; id?: string } & Partial<SingleArgs>): BaseState<any>;
export function useObjects<T = any>(args: UseObjectsArgs): BaseState<any> {
  const isSingle =
    "id" in args && typeof (args as any).id === "string" && (args as any).id.length > 0;

  const [data, setData] = React.useState<any>(undefined);
  const enabled = (args as any).enabled ?? true;
  const [isLoading, setLoading] = React.useState<boolean>(!!enabled);
  const [error, setError] = React.useState<any>(null);

  const select = (args as any).select as ((x: any) => any) | undefined;

  // explicit deps keep it predictable
  const depType   = (args as any).type;
  const depId     = isSingle ? (args as SingleArgs).id : undefined;
  const depQ      = !isSingle ? (args as ListArgs).q : undefined;
  const depFilter = !isSingle ? (args as ListArgs).filter : undefined;
  const depQuery  = !isSingle ? (args as ListArgs).query : undefined;
  const depParams = !isSingle ? (args as ListArgs).params : undefined;

  const doFetch = React.useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    let active = true;
    try {
      const raw = isSingle
        ? await fetchSingle(depType, depId as string)
        : await fetchList(depType, depQ, depFilter, depQuery, depParams);
      if (!active) return;
      setData(select ? (select as any)(raw) : raw);
    } catch (e) {
      if (!active) return;
      setError(e);
    } finally {
      if (!active) return;
      setLoading(false);
    }
  }, [enabled, select, isSingle, depType, depId, depQ, depFilter, depQuery, depParams]);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => { if (!cancelled) await doFetch(); };
    run();
    return () => { cancelled = true; };
  }, [doFetch]);

  return { data, isLoading, error, refetch: doFetch };
}
