import React, { createContext, useContext, useMemo, useState } from "react";
import { MODULES, ModuleKey, Role } from "../shared/modules";

type RolesContextType = {
  roles: Role[];
  hasRole: (r: Role) => boolean;
  setRoles: (r: Role[]) => void;
  toggleRole: (r: Role) => void;
  allowedModules: ModuleKey[];
  canAccess: (m: ModuleKey) => boolean;
};

const RolesCtx = createContext<RolesContextType | undefined>(undefined);

export const RolesProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  // Minimal default for dev: "internal" only. We’ll wire to backend later.
  const [roles, setRoles] = useState<Role[]>(["internal"]);

  const hasRole = (r: Role) => roles.includes(r);
  const toggleRole = (r: Role) =>
    setRoles((curr) => (curr.includes(r) ? curr.filter((x) => x !== r) : [...curr, r]));

  const allowedModules = useMemo<ModuleKey[]>(() => {
    return (Object.keys(MODULES) as ModuleKey[]).filter((k) => {
      const req = MODULES[k].required;
      return req.length === 0 || req.some((r) => roles.includes(r));
    });
  }, [roles]);

  const canAccess = (m: ModuleKey) => allowedModules.includes(m);

  const value: RolesContextType = {
    roles,
    hasRole,
    setRoles,
    toggleRole,
    allowedModules,
    canAccess,
  };

  return <RolesCtx.Provider value={value}>{children}</RolesCtx.Provider>;
};

export function useRoles() {
  const ctx = useContext(RolesCtx);
  if (!ctx) throw new Error("useRoles must be used inside RolesProvider");
  return ctx;
}
