import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getObject, createObject, updateObject, deleteObject } from "../../api/client";
import { newIdempotencyKey } from "./useIdempotencyKey";

export type UseObjectOpts = {
  type: string;
  id?: string | null;
  enabled?: boolean;
  staleTime?: number;
};

export function useObject<T>(optsOrType: UseObjectOpts | string, maybeId?: string | null) {
  // Back-compat: useObject("type","id")
  const opts: UseObjectOpts =
    typeof optsOrType === "string"
      ? { type: optsOrType, id: maybeId ?? undefined }
      : optsOrType;

  const { type, id, enabled, staleTime } = opts;

  return useQuery<T, Error>({
    queryKey: ["object", type, id],
    enabled: enabled ?? Boolean(id),
    queryFn: () => getObject<T>(type, String(id)),
    staleTime: staleTime ?? 15_000,
  });
}

export function useUpsertObject<T extends { id?: string; type?: string }>(type: string) {
  const qc = useQueryClient();
  return useMutation<T, Error, T>({
    mutationFn: async (obj) => {
      if ((obj as any)?.id) {
        return updateObject<T>(type, String((obj as any).id), obj, { idempotencyKey: newIdempotencyKey() });
      }
      return createObject<T>(type, obj, { idempotencyKey: newIdempotencyKey() });
    },
    onSuccess: (obj: any) => {
      qc.invalidateQueries({ queryKey: ["objects", type, "list"] });
      if (obj?.id) qc.invalidateQueries({ queryKey: ["object", type, obj.id] });
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
