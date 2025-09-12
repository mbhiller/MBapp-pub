// apps/mobile/src/features/tenants/useTenants.ts
import { useQuery } from "@tanstack/react-query";
import { listTenants, type Tenant } from "./api";

export function useTenants() {
  return useQuery({
    queryKey: ["tenants"],
    queryFn: listTenants,
    select: (data): Tenant[] => data.items ?? [],
  });
}
