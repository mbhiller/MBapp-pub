// apps/mobile/src/features/workspaces/api.ts
import { apiClient, ListPage } from "../../api/client";
import { newIdempotencyKey } from "../_shared/useIdempotencyKey";

export type WorkspaceItem = {
  id: string;
  name: string;
  entityType: string;
  description?: string;
  shared?: boolean;
  filters?: any[];
  columns?: string[];
  views?: string[];
  defaultViewId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceListParams = {
  q?: string;
  entityType?: string;
  limit?: number;
  next?: string;
  cursor?: string;
};

export type CreateWorkspacePayload = {
  name: string;
  entityType: string;
  filters?: any[];
  columns?: string[];
  description?: string;
  shared?: boolean;
  views?: string[];
  defaultViewId?: string | null;
};

export type PatchWorkspacePayload = Partial<CreateWorkspacePayload> & { ownerId?: string };

/**
 * Convert WorkspaceListParams to Record<string,string> for query params.
 * Omits undefined keys and converts numeric limit to string.
 */
function toQuery(params?: WorkspaceListParams): Record<string, string> {
  if (!params) return {};
  const result: Record<string, string> = {};
  if (params.q !== undefined) result.q = params.q;
  if (params.entityType !== undefined) result.entityType = params.entityType;
  if (params.limit !== undefined) result.limit = String(params.limit);
  if (params.cursor !== undefined) result.cursor = params.cursor;
  if (params.next !== undefined) result.next = params.next; // legacy alias
  return result;
}

export function normalizeWorkspace(obj: any): WorkspaceItem {
  return {
    id: obj?.id,
    name: obj?.name,
    entityType: obj?.entityType,
    description: obj?.description,
    shared: obj?.shared,
    filters: obj?.filters,
    columns: obj?.columns,
    views: Array.isArray(obj?.views) ? obj.views : [],
    defaultViewId: obj?.defaultViewId ?? null,
    createdAt: obj?.createdAt,
    updatedAt: obj?.updatedAt,
  } as WorkspaceItem;
}

export function buildWorkspacePutPayload(existing: any, updates: Partial<WorkspaceItem> & { name?: string; entityType?: string }) {
  const base = normalizeWorkspace(existing || {});
  const merged = { ...base, ...updates };
  return {
    name: merged.name,
    entityType: merged.entityType,
    description: merged.description,
    shared: merged.shared,
    views: Array.isArray(merged.views) ? merged.views : [],
    filters: merged.filters,
    columns: merged.columns,
  };
}

export const workspacesApi = {
  list: (params?: WorkspaceListParams): Promise<ListPage<WorkspaceItem>> => {
    return apiClient.get<ListPage<WorkspaceItem>>("/workspaces", toQuery(params)).then((res) => ({
      ...res,
      items: Array.isArray(res?.items) ? res.items.map(normalizeWorkspace) : [],
    }));
  },
  get: (id: string): Promise<WorkspaceItem> => {
    return apiClient.get<WorkspaceItem>(`/workspaces/${encodeURIComponent(id)}`).then(normalizeWorkspace);
  },
  create: (
    payload: CreateWorkspacePayload,
    opts?: { idempotencyKey?: string }
  ): Promise<WorkspaceItem> => {
    const headers = { "Idempotency-Key": opts?.idempotencyKey ?? newIdempotencyKey("ws") };
    return apiClient.post<WorkspaceItem>("/workspaces", payload, headers).then(normalizeWorkspace);
  },
  put: (
    id: string,
    payload: PatchWorkspacePayload,
    opts?: { idempotencyKey?: string }
  ): Promise<WorkspaceItem> => {
    const headers = { "Idempotency-Key": opts?.idempotencyKey ?? newIdempotencyKey("ws") };
    return apiClient.put<WorkspaceItem>(
      `/workspaces/${encodeURIComponent(id)}`,
      payload,
      headers
    ).then(normalizeWorkspace);
  },
  patch: (
    id: string,
    payload: PatchWorkspacePayload,
    opts?: { idempotencyKey?: string }
  ): Promise<WorkspaceItem> => {
    const headers = { "Idempotency-Key": opts?.idempotencyKey ?? newIdempotencyKey("ws") };
    return apiClient.patch<WorkspaceItem>(
      `/workspaces/${encodeURIComponent(id)}`,
      payload,
      headers
    ).then(normalizeWorkspace)
    .catch((err: any) => {
      if (err?.status === 405) {
        return workspacesApi.put(id, payload, opts);
      }
      throw err;
    });
  },
  del: (
    id: string,
    opts?: { idempotencyKey?: string }
  ): Promise<{ id: string; deleted: boolean }> => {
    const headers = { "Idempotency-Key": opts?.idempotencyKey ?? newIdempotencyKey("ws") };
    return apiClient.del(`/workspaces/${encodeURIComponent(id)}`, headers);
  },
};
