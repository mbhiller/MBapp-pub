// apps/mobile/src/features/workspaces/api.ts
import { apiClient, ListPage } from "../../api/client";
import { newIdempotencyKey } from "../_shared/useIdempotencyKey";

export type WorkspaceItem = {
  id: string;
  name: string;
  entityType: string;
  filters?: any[];
  columns?: string[];
  views?: string[];
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceListParams = {
  q?: string;
  entityType?: string;
  limit?: number;
  next?: string;
};

export type CreateWorkspacePayload = {
  name: string;
  entityType: string;
  filters?: any[];
  columns?: string[];
  description?: string;
  shared?: boolean;
  views?: string[];
};

export type PatchWorkspacePayload = Partial<CreateWorkspacePayload>;

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
  if (params.next !== undefined) result.next = params.next;
  return result;
}

export const workspacesApi = {
  list: (params?: WorkspaceListParams): Promise<ListPage<WorkspaceItem>> => {
    return apiClient.get<ListPage<WorkspaceItem>>("/workspaces", toQuery(params));
  },
  get: (id: string): Promise<WorkspaceItem> => {
    return apiClient.get<WorkspaceItem>(`/workspaces/${encodeURIComponent(id)}`);
  },
  create: (
    payload: CreateWorkspacePayload,
    opts?: { idempotencyKey?: string }
  ): Promise<WorkspaceItem> => {
    const headers = { "Idempotency-Key": opts?.idempotencyKey ?? newIdempotencyKey("ws") };
    return apiClient.post<WorkspaceItem>("/workspaces", payload, headers);
  },
  patch: (
    id: string,
    payload: PatchWorkspacePayload,
    opts?: { idempotencyKey?: string }
  ): Promise<WorkspaceItem> => {
    const headers = { "Idempotency-Key": opts?.idempotencyKey ?? newIdempotencyKey("ws") };
    return apiClient.put<WorkspaceItem>(
      `/workspaces/${encodeURIComponent(id)}`,
      payload,
      headers
    );
  },
  del: (
    id: string,
    opts?: { idempotencyKey?: string }
  ): Promise<{ id: string; deleted: boolean }> => {
    const headers = { "Idempotency-Key": opts?.idempotencyKey ?? newIdempotencyKey("ws") };
    return apiClient.del(`/workspaces/${encodeURIComponent(id)}`, headers);
  },
};
