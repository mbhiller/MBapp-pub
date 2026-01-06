import { createContext, useContext, useMemo, useState, type ReactNode, useEffect } from "react";
import * as Sentry from "@sentry/browser";
import { apiFetch } from "../lib/http";

export type AuthContextValue = {
  token: string | null;
  tenantId: string;
  apiBase: string;
  policy: Record<string, boolean> | null;
  policyLoading: boolean;
  policyError: string | null;
  setToken: (token: string | null) => void;
  setTenantOverride: (tenantId: string | null) => void;
  tenantOverride: string | null;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const STORAGE_KEY = "mbapp_bearer";
const TENANT_STORAGE_KEY = "mbapp_tenant";
const TENANT_OVERRIDE_KEY = "mbapp.tenantOverride";

const apiBase = import.meta.env.VITE_API_BASE;
const fallbackTenantId = import.meta.env.VITE_TENANT;

if (!apiBase) {
  throw new Error("Missing VITE_API_BASE. Set it in apps/web/.env (no localhost fallback).");
}
if (!fallbackTenantId) {
  throw new Error("Missing VITE_TENANT. Set it in apps/web/.env.");
}

/**
 * Decode JWT payload and extract mbapp.tenantId if present.
 * Returns null if token is invalid or tenant field is missing.
 */
function decodeJwtTenant(token: string | null): string | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.mbapp?.tenantId ?? null;
  } catch {
    return null;
  }
}

function readInitialToken(): string | null {
  try {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (stored) return stored;
  } catch {}
  const envToken = import.meta.env.VITE_BEARER as string | undefined;
  return envToken || null;
}

function deriveTenantId(token: string | null): string {
  // 0. DEV only: check for tenantOverride (useful for debugging with SmokeTenant)
  if (import.meta.env.DEV) {
    try {
      const override = typeof localStorage !== "undefined" ? localStorage.getItem(TENANT_OVERRIDE_KEY) : null;
      if (override) return override;
    } catch {}
  }

  // 1. Prefer tenant from token
  const tokenTenant = decodeJwtTenant(token);
  if (tokenTenant) return tokenTenant;

  // 2. Fall back to stored tenant
  try {
    const storedTenant = typeof localStorage !== "undefined" ? localStorage.getItem(TENANT_STORAGE_KEY) : null;
    if (storedTenant) return storedTenant;
  } catch {}

  // 3. Fall back to env
  return fallbackTenantId;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialToken = readInitialToken();
  const [token, setTokenState] = useState<string | null>(initialToken);
  const [tenantOverride, setTenantOverrideState] = useState<string | null>(() => {
    if (import.meta.env.DEV) {
      try {
        return typeof localStorage !== "undefined" ? localStorage.getItem(TENANT_OVERRIDE_KEY) : null;
      } catch {}
    }
    return null;
  });
  const [tenantId, setTenantId] = useState<string>(() => deriveTenantId(initialToken));
  const [policy, setPolicy] = useState<Record<string, boolean> | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const jwtTenant = useMemo(() => decodeJwtTenant(token), [token]);

  const setToken = (value: string | null) => {
    setTokenState(value);
    const newTenantId = deriveTenantId(value);
    setTenantId(newTenantId);

    try {
      if (value) {
        localStorage.setItem(STORAGE_KEY, value);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
      // Sync tenant to localStorage to keep aligned
      localStorage.setItem(TENANT_STORAGE_KEY, newTenantId);
    } catch {}
  };

  const setTenantOverride = (overrideTenantId: string | null) => {
    if (import.meta.env.DEV) {
      try {
        if (overrideTenantId) {
          localStorage.setItem(TENANT_OVERRIDE_KEY, overrideTenantId);
          setTenantOverrideState(overrideTenantId);
        } else {
          localStorage.removeItem(TENANT_OVERRIDE_KEY);
          setTenantOverrideState(null);
        }
        // Re-derive tenantId to pick up the override
        const newTenantId = deriveTenantId(token);
        setTenantId(newTenantId);
      } catch {}
    }
  };

  // Fetch /auth/policy whenever token or tenantId changes
  useEffect(() => {
    if (!token) {
      setPolicy(null);
      setPolicyLoading(false);
      setPolicyError(null);
      return;
    }

    (async () => {
      setPolicyLoading(true);
      setPolicyError(null);
      try {
        const result = await apiFetch<Record<string, boolean>>("/auth/policy", {
          token,
          tenantId,
        });
        setPolicy(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.warn("Failed to fetch /auth/policy:", msg);
        setPolicy({});
        setPolicyError(msg);
      } finally {
        setPolicyLoading(false);
      }
    })();
  }, [token, tenantId]);

  const value = useMemo<AuthContextValue>(
    () => ({ token, tenantId, apiBase, policy, policyLoading, policyError, setToken, setTenantOverride, tenantOverride }),
    [token, tenantId, policy, policyLoading, policyError, tenantOverride]
  );

  // Attach Sentry tags when auth context is available; safe if Sentry not initialized
  useEffect(() => {
    try {
      // Always tag source=web
      Sentry.setTag("source", "web");
      // Only tag tenantId (no unsafe JWT decode for actorId)
      if (tenantId) Sentry.setTag("tenantId", tenantId);
      // Clear user on logout
      if (!token) {
        Sentry.setUser(null);
      }
    } catch {}
  }, [token, tenantId]);

  const showTenantMismatch = Boolean(
    import.meta.env.DEV && token && jwtTenant && jwtTenant !== tenantId
  );

  return (
    <AuthContext.Provider value={value}>
      {showTenantMismatch ? (
        <div
          style={{
            background: "#fff3cd",
            color: "#664d03",
            padding: "8px 12px",
            borderBottom: "1px solid #ffe69c",
            fontSize: 13,
          }}
        >
          <strong>Tenant mismatch</strong> — JWT tenant: {jwtTenant} · Request tenant: {tenantId}
          <div style={{ marginTop: 4 }}>
            Clear localStorage or set mbapp_tenant / mbapp_bearer
          </div>
        </div>
      ) : null}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

