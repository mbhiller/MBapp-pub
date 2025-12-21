// apps/mobile/src/features/workspaces/api.ts
import { apiClient, ListPage } from "../../api/client";

export type WorkspaceItem = {
  id: string;
  name: string;
  entityType: string;
  filters?: any[];
  columns?: string[];
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceListParams = {
  q?: string;
  entityType?: string;
  limit?: number;
  next?: string;
};

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
};
