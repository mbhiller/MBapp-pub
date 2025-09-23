// apps/mobile/src/providers/RolesProvider.tsx
import React, { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { MODULES, type ModuleEntry } from "../features/_shared/modules";

// Keep roles simple strings; you can tighten this to a string union if desired.
export type Role = string;

type Ctx = {
  roles: Role[];
  setRoles(next: Role[]): void;
  has(role: Role): boolean;
  allowedModules: ModuleEntry[];
  can(required: Role | Role[] | undefined): boolean;
};

const RolesCtx = createContext<Ctx | undefined>(undefined);

export function RolesProvider({
  children,
  initialRoles,
}: {
  children: ReactNode;
  initialRoles?: (string | Role)[];
}) {
  const initial: Role[] = (initialRoles ?? [])
    .map((r) => String(r).trim())
    .filter(Boolean);

  const [roles, setRoles] = useState<Role[]>(initial);

  const has = (r: Role) => roles.includes(r);

  const can = (req: Role | Role[] | undefined) => {
    if (!req) return true;                // no requirement = allowed
    const needs = Array.isArray(req) ? req : [req];
    if (needs.length === 0) return true;  // [] = allow all
    return needs.some((r) => roles.includes(r));
  };

  const allowedModules = useMemo(
    () => MODULES.filter((m) => can(m.required)),
    [roles] // recompute when roles change
  );

  const value: Ctx = { roles, setRoles, has, allowedModules, can };
  return <RolesCtx.Provider value={value}>{children}</RolesCtx.Provider>;
}

export function useRoles() {
  const ctx = useContext(RolesCtx);
  if (!ctx) throw new Error("useRoles must be used within RolesProvider");
  return ctx;
}
