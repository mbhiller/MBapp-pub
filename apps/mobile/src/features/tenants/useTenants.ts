import { useQuery } from "@tanstack/react-query";
import { listTenants } from "./api";

export function useTenants() {
  return useQuery({
    queryKey: ["tenants"],
    queryFn: () => listTenants(),
    staleTime: 60_000,
  });
}
