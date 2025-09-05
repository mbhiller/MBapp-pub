// src/features/tenants/useTenants.ts
import { useQuery } from '@tanstack/react-query';
import { listTenants } from './api';
import { TenantsFlexible, type Tenants } from '../../lib/z';

export function useTenants() {
  return useQuery<Tenants>({
    queryKey: ['tenants'],
    queryFn: async () => {
      const raw = await listTenants();
      try {
        return TenantsFlexible.parse(raw);
      } catch (e) {
        // Log a helpful snippet to Metro for debugging
        try {
          console.log(
            'TENANTS parse error. Raw data (first 1k chars):',
            JSON.stringify(raw).slice(0, 1000)
          );
        } catch {}
        throw e;
      }
    },
    staleTime: 0,
  });
}
