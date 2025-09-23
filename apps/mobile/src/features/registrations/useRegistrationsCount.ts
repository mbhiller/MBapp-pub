import { useQuery } from "@tanstack/react-query";
import { listObjects } from "../../api/client";

type ListPage<T> = { items: T[]; next?: string | null };
type RegistrationRef = { type?: string; refType?: string; id?: string; refId?: string };
type Registration = {
  id: string; type: "registration"; eventId?: string; refs?: RegistrationRef[]; [k: string]: any;
};

async function countForEvent(eventId: string): Promise<number> {
  if (!eventId) return 0;
  let next: string | undefined = undefined;
  let count = 0;

  for (let i = 0; i < 50; i++) {
    const resp = await listObjects<Registration>("registration", {
      eventId, limit: 200, next, by: "updatedAt", sort: "desc",
    });
    const page = resp as unknown as ListPage<Registration>;
    const items: Registration[] = Array.isArray(page?.items) ? page.items : [];

    count += items.filter((it: Registration) => {
      const id =
        it?.eventId ?? it?.event_id ?? it?.event ?? it?.event?.id ?? it?.meta?.eventId;
      if (id && id === eventId) return true;
      if (Array.isArray(it?.refs)) {
        return it.refs.some(
          (r: RegistrationRef) =>
            (r?.type === "event" || r?.refType === "event") &&
            (r?.id === eventId || r?.refId === eventId)
        );
      }
      return false;
    }).length;

    next = (page?.next ?? undefined) || undefined;
    if (!next) break;
  }
  return count;
}

export function useRegistrationsCount(eventIds: (string | null | undefined)[] | undefined, opts?: { enabled?: boolean }) {
  const ids = Array.from(new Set((eventIds ?? []).filter(Boolean))) as string[];
  const enabled = (opts?.enabled ?? true) && ids.length > 0;
  return useQuery<Record<string, number>>({
    enabled,
    queryKey: ["registrations", "counts", ids.sort().join(",")],
    queryFn: async () => {
      const results = await Promise.all(ids.map((id) => countForEvent(id)));
      const map: Record<string, number> = {};
      ids.forEach((id, i) => (map[id] = results[i] ?? 0));
      return map;
    },
  });
}
