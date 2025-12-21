// apps/mobile/src/features/registrations/hooks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listRegistrations, getRegistration, createRegistration, RegistrationListParams, CreateRegistrationInput } from "./api";
import type { Registration } from "./types";

export function useRegistrations(params?: RegistrationListParams) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["registrations", params],
    queryFn: () => listRegistrations(params),
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

export function useRegistration(id: string | undefined) {
  return useQuery({
    queryKey: ["registration", id],
    queryFn: () => getRegistration(id!),
    enabled: !!id,
  });
}

export function useCreateRegistration() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (input: CreateRegistrationInput) => createRegistration(input),
    onSuccess: (created) => {
      // Update single item cache
      queryClient.setQueryData(["registration", created.id], created);
      // Invalidate list queries
      queryClient.invalidateQueries({ queryKey: ["registrations"] });
    },
  });
}
