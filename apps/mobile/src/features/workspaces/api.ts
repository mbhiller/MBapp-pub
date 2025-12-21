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

export const workspacesApi = {
  list: (params?: WorkspaceListParams): Promise<ListPage<WorkspaceItem>> => {
    return apiClient.get<ListPage<WorkspaceItem>>("/workspaces", params);
  },
  get: (id: string): Promise<WorkspaceItem> => {
    return apiClient.get<WorkspaceItem>(`/workspaces/${encodeURIComponent(id)}`);
  },
};
