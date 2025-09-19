// apps/mobile/src/providers/RolesProvider.tsx
import React, { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { MODULES, type Role, type ModuleDef } from "../shared/modules";

type Ctx = {
  roles: Role[];
  setRoles(next: Role[]): void;
  has(role: Role): boolean;
  allowedModules: ModuleDef[];
  can(required: Role | Role[]): boolean;
};

const RolesCtx = createContext<Ctx | undefined>(undefined);

export function RolesProvider({
  children,
  initialRoles,
}: {
  children: React.ReactNode;
  initialRoles?: (string | Role)[]; // <= allow strings or Role literals
}) {
  const initial: Role[] = (initialRoles ?? [])
    .map(r => String(r).trim())
    .filter(Boolean) as Role[];
  const [roles, setRoles] = useState<Role[]>(initial);

  const has = (r: Role) => roles.includes(r);
  const can = (req: Role | Role[]) => {
  const needs = Array.isArray(req) ? req : [req];
  if (needs.length === 0) return true;      // <-- allow-all for []
  return needs.some((r) => roles.includes(r));
};
  const allowedModules = useMemo(
    () => MODULES.filter((m) => can(m.required)),
    [roles]
  );

  const value: Ctx = { roles, setRoles, has, allowedModules, can };
  return <RolesCtx.Provider value={value}>{children}</RolesCtx.Provider>;
}

export function useRoles() {
  const ctx = useContext(RolesCtx);
  if (!ctx) throw new Error("useRoles must be used within RolesProvider");
  return ctx;
}
