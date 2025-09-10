// apps/mobile/src/features/tenants/useTenants.ts
import { useQuery } from "@tanstack/react-query";
import { listTenants, type Tenant } from "./api";

export function useTenants() {
  return useQuery<Tenant[]>({
    queryKey: ["tenants"],
    queryFn: ({ signal }) => listTenants({ signal }),
    // Tenants rarely change; keep a little longer to avoid refetch churn
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
