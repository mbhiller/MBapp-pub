import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getObject, createObject, updateObject, deleteObject } from "../../api/client";
import { newIdempotencyKey } from "./useIdempotencyKey";

export function useObject<T>(type: string, id?: string | null) {
  return useQuery<T, Error>({
    queryKey: ["object", type, id],
    enabled: Boolean(id),
    queryFn: () => getObject<T>(type, String(id)),
    staleTime: 15_000,
  });
}

export function useUpsertObject<T extends { id?: string; type?: string }>(type: string) {
  const qc = useQueryClient();
  return useMutation<T, Error, Partial<T>>({
    mutationFn: (payload) => {
      const idemp = newIdempotencyKey(type);
      if (payload.id) {
        return updateObject<T>(type, String(payload.id), payload, { idempotencyKey: idemp });
      }
      return createObject<T>(type, { ...payload, type } as Partial<T>, { idempotencyKey: idemp });
    },
    onSuccess: (obj) => {
      // refresh list + detail caches
      qc.invalidateQueries({ queryKey: ["objects", type, "list"] });
      if ((obj as any)?.id) qc.invalidateQueries({ queryKey: ["object", type, (obj as any).id] });
    },
  });
}

export function useDeleteObject(type: string) {
  const qc = useQueryClient();
  return useMutation<{ id: string; type: string; deleted: boolean }, Error, { id: string }>({
    mutationFn: ({ id }) => deleteObject(type, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["objects", type, "list"] });
    },
  });
}
