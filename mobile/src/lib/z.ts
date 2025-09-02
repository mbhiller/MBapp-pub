// src/lib/z.ts
import { z } from "zod";

// Coerce numbers/nullables to strings where possible
const Stringish = z.preprocess((v) => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") return String(v);
  return v;
}, z.string());

// Accept multiple possible backend field names and coerce to our canonical shape
const TenantLoose = z
  .object({
    id: Stringish.optional(),
    tenantId: Stringish.optional(),
    name: Stringish.optional(),
    tenantName: Stringish.optional(),
    slug: Stringish.optional(),
    code: Stringish.optional(),
  })
  .transform((t) => {
    const id = t.id ?? t.tenantId ?? t.code ?? t.slug ?? t.tenantName ?? t.name ?? "unknown";
    const name = t.name ?? t.tenantName ?? t.slug ?? t.code ?? id;
    const slug =
      t.slug ??
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
    return { id, name, slug };
  });

export const TenantsFlexible = z
  .union([
    z.array(TenantLoose),                                  // [ {...}, {...} ]
    z.object({ items: z.array(TenantLoose) }).transform((o) => o.items), // { items: [...] }
    z.object({ data: z.array(TenantLoose) }).transform((o) => o.data),   // { data: [...] }
  ])
  .transform((v) => (Array.isArray(v) ? v : (v as any)));

export type Tenant = z.infer<typeof TenantLoose>;
export type Tenants = Tenant[];
