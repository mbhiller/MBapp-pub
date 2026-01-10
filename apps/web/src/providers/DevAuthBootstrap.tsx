import { useState, useEffect, type ReactNode } from "react";

const DEV_EMAIL = import.meta.env.VITE_DEV_EMAIL || "dev@example.com";
const DEV_TENANT = import.meta.env.VITE_DEV_TENANT || import.meta.env.VITE_TENANT || "DemoTenant";
const DEV_AUTH_DISABLED = import.meta.env.VITE_DEV_AUTH_DISABLED === "true" || import.meta.env.VITE_DEV_AUTH_DISABLED === "1";

const STORAGE_KEY = "mbapp_bearer";
const TENANT_STORAGE_KEY = "mbapp_tenant";

function decodeMbappClaim(token: string | null): any | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.mbapp ?? null;
  } catch {
    return null;
  }
}

/**
 * DevAuthBootstrap for web
 * In DEV mode with DemoTenant, calls POST /auth/dev-login to obtain a token with roles.
 * Stores token in localStorage so AuthProvider picks it up.
 * This mirrors the mobile DevAuthBootstrap behavior.
 */
export function DevAuthBootstrap({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Only run in DEV mode and when DemoTenant is configured
        if (!import.meta.env.DEV || DEV_TENANT !== "DemoTenant") {
          console.log("DevAuthBootstrap: skipped (not DEV or not DemoTenant)", {
            isDev: import.meta.env.DEV,
            tenant: DEV_TENANT,
          });
          setReady(true);
          return;
        }

        // Allow opt-out of dev-login for public/unauth testing
        if (DEV_AUTH_DISABLED) {
          console.log("DevAuthBootstrap: disabled via VITE_DEV_AUTH_DISABLED flag");
          setReady(true);
          return;
        }

        // Check if a stored token is valid for DEV tenant with roles/policy
        let storedToken: string | null = null;
        try {
          storedToken = localStorage.getItem(STORAGE_KEY);
        } catch {}

        const mbappClaim = decodeMbappClaim(storedToken);
        const hasTenantMatch = mbappClaim?.tenantId === DEV_TENANT;
        const hasRoles = Array.isArray(mbappClaim?.roles) && mbappClaim.roles.length > 0;
        const hasPolicy = mbappClaim?.policy && typeof mbappClaim.policy === "object" && Object.keys(mbappClaim.policy).length > 0;

        if (storedToken && hasTenantMatch && (hasRoles || hasPolicy)) {
          console.log("DevAuthBootstrap: stored token valid, skipping dev-login", {
            tenant: DEV_TENANT,
            roles: mbappClaim?.roles,
            hasPolicy,
          });
          setReady(true);
          return;
        }

        // Call /auth/dev-login to get a token with admin roles
        const apiBase = import.meta.env.VITE_API_BASE;
        console.log("DevAuthBootstrap: calling /auth/dev-login", {
          email: DEV_EMAIL,
          tenantId: DEV_TENANT,
        });

        const res = await fetch(`${apiBase}/auth/dev-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: DEV_EMAIL,
            tenantId: DEV_TENANT,
          }),
        });

        if (!res.ok) {
          throw new Error(`dev-login failed: ${res.status} ${res.statusText}`);
        }

        const data: { token?: string } = await res.json();
        if (!data.token) {
          throw new Error("dev-login returned no token");
        }

        // Store token and tenant for AuthProvider to pick up
        try {
          localStorage.setItem(STORAGE_KEY, data.token);
          localStorage.setItem(TENANT_STORAGE_KEY, DEV_TENANT);
          console.log("DevAuthBootstrap: token stored successfully", { tenant: DEV_TENANT });
        } catch (e) {
          console.warn("DevAuthBootstrap: failed to store token", e);
        }
      } catch (e) {
        console.error("DevAuthBootstrap error:", e);
        // Continue anyway; auth will fall back to other mechanisms or show login page
      } finally {
        setReady(true);
      }
    })();
  }, []);

  if (!ready) {
    // Return null while bootstrapping to prevent race conditions
    return null;
  }

  return <>{children}</>;
}
