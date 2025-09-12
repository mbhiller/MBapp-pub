import React, { createContext, useContext, useMemo } from "react";
import { MODULES, MODULES_BY_KEY, type ModuleKey, type Role, type ModuleDef } from "../shared/modules";

type RolesContextValue = {
  roles: Role[];
  hasRole: (r: Role) => boolean;
  canAccessModule: (key: ModuleKey) => boolean;
  allowedModules: ModuleDef[];
};

const RolesContext = createContext<RolesContextValue | null>(null);

export function RolesProvider({
  children,
  initialRoles,
}: {
  children: React.ReactNode;
  /** Provide real user roles here once auth is wired */
  initialRoles?: Role[];
}) {
  // Minimal, safe defaults allow basic viewing everywhere
  const roles: Role[] = initialRoles ?? ["objects.view", "products.view", "tenants.view"];

  const hasRole = (r: Role) => roles.includes(r);

  const canAccessModule = (key: ModuleKey) => {
    const req = MODULES_BY_KEY[key].required;
    return req.length === 0 || req.some((rr: Role) => hasRole(rr));
  };

  const allowedModules = useMemo(
    () => MODULES.filter((m) => canAccessModule(m.key)),
    [roles]
  );

  const value: RolesContextValue = { roles, hasRole, canAccessModule, allowedModules };
  return <RolesContext.Provider value={value}>{children}</RolesContext.Provider>;
}

export function useRoles() {
  const ctx = useContext(RolesContext);
  if (!ctx) throw new Error("useRoles must be used within RolesProvider");
  return ctx;
}
