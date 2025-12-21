// apps/mobile/src/features/workspaces/hooks.ts
import { useQuery } from "@tanstack/react-query";
import { workspacesApi, WorkspaceListParams, WorkspaceItem } from "./api";

export function useWorkspaceItems(params?: WorkspaceListParams) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["workspaces", params],
    queryFn: () => workspacesApi.list(params),
    staleTime: 30000, // 30s
  });

  return {
    data: data?.items ?? [],
    next: data?.next,
    isLoading,
    error,
    refetch,
  };
}

export function useWorkspaceItem(id: string | undefined) {
  return useQuery({
    queryKey: ["workspace", id],
    queryFn: () => workspacesApi.get(id!),
    enabled: !!id,
  });
}
