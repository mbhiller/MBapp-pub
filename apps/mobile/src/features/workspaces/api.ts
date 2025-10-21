// apps/mobile/src/features/workspaces/api.ts
import { apiClient } from "../../api/client";

export type Workspace = { id: string; name: string; /* ... */ };

export const workspacesApi = {
  list: () => apiClient.get<Workspace[]>("/workspaces"),
  get:  (id: string) => apiClient.get<Workspace>(`/workspaces/${encodeURIComponent(id)}`),
};
