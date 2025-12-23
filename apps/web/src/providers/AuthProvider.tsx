import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type AuthContextValue = {
  token: string | null;
  tenantId: string;
  apiBase: string;
  setToken: (token: string | null) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const STORAGE_KEY = "mbapp_bearer";

const apiBase = import.meta.env.VITE_API_BASE;
const tenantId = import.meta.env.VITE_TENANT;

if (!apiBase) {
  throw new Error("Missing VITE_API_BASE. Set it in apps/web/.env (no localhost fallback).");
}
if (!tenantId) {
  throw new Error("Missing VITE_TENANT. Set it in apps/web/.env.");
}

function readInitialToken(): string | null {
  try {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (stored) return stored;
  } catch {}
  const envToken = import.meta.env.VITE_BEARER as string | undefined;
  return envToken || null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => readInitialToken());

  const setToken = (value: string | null) => {
    setTokenState(value);
    try {
      if (value) {
        localStorage.setItem(STORAGE_KEY, value);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
  };

  const value = useMemo<AuthContextValue>(
    () => ({ token, tenantId, apiBase, setToken }),
    [token]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
