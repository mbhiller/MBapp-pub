// Canonical hook for both single-object and list fetching.
// List mode ALWAYS returns { items: T[]; total?: number } in `data`.
// Single mode returns object T in `data`.
// State shape is { data, isLoading, error, refetch } for both modes.
// (Sprint H) Adds optional `pageInfo` when API provides it.
// (Sprint I) Adds non-breaking pagination helpers for list mode: hasNext/fetchNext/reset.
//            Understands either `pageInfo.nextCursor` or legacy `next` and merges pages.

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

// Optional pagination metadata surfaced by API (non-breaking for callers)
export type PageInfo =
  | {
      hasNext: boolean;
      nextCursor: string | null;
      pageSize?: number;
    }
  | undefined;

type BaseState<T> = {
  data: T | undefined;
  isLoading: boolean;
  error: any;
  refetch: () => Promise<void>;
  // Optional pagination metadata when API includes it
  pageInfo?: PageInfo;
  // New (optional) helpers for list mode (safe to ignore by existing callers)
  hasNext?: boolean;
  fetchNext?: () => Promise<void>;
  reset?: () => void;
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
  const res = await apiClient.get(
    `/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`
  );
  return (res as any).body ?? res;
}

type RawPage<T = any> = {
  items?: T[];
  total?: number;
  pageInfo?: PageInfo | { nextCursor?: string | null; hasNext?: boolean };
  next?: string | null; // legacy cursor some endpoints return
  data?: T[]; // alternate shape
  pages?: Array<{ items?: T[] }>; // alternate shape
};

async function fetchList(
  type: string,
  q?: string,
  filter?: Record<string, any>,
  query?: Record<string, any>,
  params?: Record<string, any>
): Promise<RawPage> {
  const qs = buildQS(q, filter, query, params);
  const res = await apiClient.get(`/objects/${encodeURIComponent(type)}${qs}`);
  return ((res as any).body ?? res) as RawPage;
}

// Overloads so TS infers the right data shape at call sites
export function useObjects<T = any>(args: SingleArgs): BaseState<T>;
export function useObjects<T = any>(args: ListArgs): BaseState<ListResult<T>>;
// Fallback for cases where id is possibly undefined from routing
export function useObjects<T = any>(
  args: { type: string; id?: string } & Partial<SingleArgs>
): BaseState<any>;
export function useObjects<T = any>(args: UseObjectsArgs): BaseState<any> {
  const isSingle =
    "id" in args && typeof (args as any).id === "string" && (args as any).id.length > 0;

  const enabled = (args as any).enabled ?? true;
  const select = (args as any).select as ((x: any) => any) | undefined;

  // explicit deps keep it predictable
  const depType = (args as any).type;
  const depId = isSingle ? (args as SingleArgs).id : undefined;
  const depQ = !isSingle ? (args as ListArgs).q : undefined;
  const depFilter = !isSingle ? (args as ListArgs).filter : undefined;
  const depQuery = !isSingle ? (args as ListArgs).query : undefined;
  const depParams = !isSingle ? (args as ListArgs).params : undefined;

  // unified state
  const [data, setData] = React.useState<any>(undefined);
  const [pageInfo, setPageInfo] = React.useState<PageInfo>(undefined);
  const [nextLegacy, setNextLegacy] = React.useState<string | null>(null); // for endpoints that return `next`
  const [isLoading, setLoading] = React.useState<boolean>(!!enabled);
  const [error, setError] = React.useState<any>(null);

  // for list merging across pages
  const isList = !isSingle;
  const baseParamsJSON = JSON.stringify(depParams ?? {});
  const baseQueryJSON = JSON.stringify(depQuery ?? {});
  const baseFilterJSON = JSON.stringify(depFilter ?? {});
  const baseQ = depQ ?? "";

  // Guard to prevent state updates after unmount or parameter change
  const reqToken = React.useRef(0);

  const computeHasNext = React.useCallback(
    (pi?: PageInfo, legacy?: string | null) => {
      // Prefer explicit hasNext when present; otherwise fall back to cursors.
      const explicit = (pi as any)?.hasNext;
      if (typeof explicit === "boolean") return explicit;
      return !!((pi as any)?.nextCursor) || !!legacy;
    },
    []
  );

  const doFetch = React.useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const myReq = ++reqToken.current;
    setLoading(true);
    setError(null);

    try {
      if (isSingle) {
        const raw = await fetchSingle(depType, depId as string);
        if (reqToken.current !== myReq) return;
        const final = select ? (select as any)(raw) : raw;
        setData(final);
        setPageInfo(undefined);
        setNextLegacy(null);
      } else {
        // first page fetch (no `next`)
        const raw = await fetchList(
          depType,
          baseQ,
          depFilter as any,
          depQuery as any,
          JSON.parse(baseParamsJSON)
        );
        if (reqToken.current !== myReq) return;

        // normalize common server shapes -> { items, total? }
        let items: any[] =
          Array.isArray(raw?.items)
            ? raw.items!
            : Array.isArray(raw?.data)
            ? raw.data!
            : raw?.pages
            ? raw.pages.flatMap((p: any) => p?.items ?? [])
            : Array.isArray(raw)
            ? (raw as any[])
            : raw
            ? [raw as any]
            : [];

        const total = (raw as any)?.total as number | undefined;
        const pi = (raw as any)?.pageInfo as PageInfo | undefined;
        const legacyNext = (raw as any)?.next ?? null;

        const normalized = { items, ...(total !== undefined ? { total } : {}) };
        const final = select ? (select as any)(normalized) : normalized;

        setData(final); // first page
        setPageInfo(pi);
        setNextLegacy(legacyNext);
      }
    } catch (e) {
      if (reqToken.current !== myReq) return;
      setError(e);
    } finally {
      if (reqToken.current !== myReq) return;
      setLoading(false);
    }
  }, [
    enabled,
    isSingle,
    depType,
    depId,
    baseQ,
    baseFilterJSON,
    baseQueryJSON,
    baseParamsJSON,
    select,
  ]);

  // Refetch on deps change
  React.useEffect(() => {
    return () => {
      // invalidate pending
      reqToken.current++;
    };
  }, [depType, depId, baseQ, baseFilterJSON, baseQueryJSON, baseParamsJSON, enabled, isSingle, select]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await doFetch();
    })();
    return () => {
      cancelled = true;
    };
  }, [doFetch]);

  // fetchNext for list mode (non-breaking addition)
  const fetchNext = React.useCallback(async () => {
    if (!isList) return;
    const cursor = (pageInfo as any)?.nextCursor ?? nextLegacy ?? null;
    if (!cursor) return;

    const myReq = ++reqToken.current;
    setLoading(true);

    try {
      const mergedParams = {
        ...(JSON.parse(baseParamsJSON) as Record<string, any>),
        // Prefer `next` for compatibility; server may also accept `cursor`.
        next: cursor,
      };
      const raw = await fetchList(
        depType,
        baseQ,
        depFilter as any,
        depQuery as any,
        mergedParams
      );
      if (reqToken.current !== myReq) return;

      let more: any[] =
        Array.isArray(raw?.items)
          ? raw.items!
          : Array.isArray(raw?.data)
          ? raw.data!
          : raw?.pages
          ? raw.pages.flatMap((p: any) => p?.items ?? [])
          : Array.isArray(raw)
          ? (raw as any[])
          : raw
          ? [raw as any]
          : [];

      const total = (raw as any)?.total as number | undefined;
      const pi = (raw as any)?.pageInfo as PageInfo | undefined;
      const legacyNext = (raw as any)?.next ?? null;

      setData((prev: any) => {
        const prevItems = Array.isArray(prev?.items) ? prev.items : [];
        const merged = { items: [...prevItems, ...more] } as any;
        if (prev?.total !== undefined || total !== undefined) {
          merged.total = total ?? prev?.total;
        }
        return merged;
      });
      setPageInfo(pi);
      setNextLegacy(legacyNext);
    } finally {
      if (reqToken.current !== myReq) return;
      setLoading(false);
    }
  }, [isList, pageInfo, nextLegacy, depType, baseQ, baseFilterJSON, baseQueryJSON, baseParamsJSON, depFilter, depQuery]);

  // reset list accumulation (useful when external code changes filters and wants a manual clear)
  const reset = React.useCallback(() => {
    if (!isList) return;
    setData(undefined);
    setPageInfo(undefined);
    setNextLegacy(null);
    // trigger a fresh fetch
    void doFetch();
  }, [isList, doFetch]);

  const hasNext = isList ? computeHasNext(pageInfo, nextLegacy) : undefined;

  return {
    data,
    isLoading,
    error,
    refetch: doFetch,
    pageInfo,
    hasNext,
    fetchNext,
    reset,
  };
}
