// apps/mobile/src/providers/DevAuthBootstrap.tsx
import * as React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
// Sentry used via dynamic require to avoid hard dependency when DSN not configured
import { setTelemetryContext } from "../lib/telemetry";
import { apiClient, getApiBase, setBearerToken, setTenantId, _debugConfig } from "../api/client";

const LEGACY_TOKEN_KEY  = "mbapp.dev.token";
const TENANT_KEY        = "mbapp.dev.tenant";

const DEV_EMAIL  = process.env.EXPO_PUBLIC_DEV_EMAIL  || "dev@example.com";
const ENV_TENANT = process.env.EXPO_PUBLIC_MBAPP_TENANT_ID || process.env.EXPO_PUBLIC_TENANT_ID || null;
const DEV_TENANT = ENV_TENANT || "DemoTenant";

function normalizeKeyPart(value?: string | null) {
  return (value ?? "").trim().replace(/[^a-zA-Z0-9._-]+/g, "_") || "default";
}

function tokenKey(base: string, tenant: string) {
  return `mbapp.bearer:${normalizeKeyPart(base)}:${normalizeKeyPart(tenant)}`;
}

export function DevAuthBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const base = getApiBase();

        // 1) Load any stored creds (tenant-aware + legacy fallback)
        const storedTenant = await AsyncStorage.getItem(TENANT_KEY);
        const tenant = ENV_TENANT || storedTenant || DEV_TENANT;
        const tenantScopedKey = tokenKey(base, tenant);
        const [tenantToken, legacyToken] = await Promise.all([
          AsyncStorage.getItem(tenantScopedKey),
          AsyncStorage.getItem(LEGACY_TOKEN_KEY),
        ]);
        let token = tenantToken;
        if (!token && legacyToken && (storedTenant || DEV_TENANT) === tenant) {
          // Legacy fallback only when tenant matches
          token = legacyToken;
        }
        setTenantId(tenant);
        // Tag Sentry with source and tenantId (no unsafe actorId decode)
        try {
          const Sentry = require("@sentry/react-native");
          Sentry.setTag("source", "mobile");
          if (tenant) Sentry.setTag("tenantId", tenant);
        } catch {}

        if (token) {
          setBearerToken(token);
          // 🔎 Quick probe: verify token still works
          try {
            await apiClient.get("/auth/policy");
            console.log("DevAuthBootstrap: using stored token", _debugConfig());
            setReady(true);
            return;
          } catch (e) {
            console.warn("DevAuthBootstrap: stored token failed, re-login…");
          }
        } else {
          console.log(`DevAuthBootstrap: no stored token for tenant=${tenant} base=${base}`);
        }

        // 2) Dev login (no auth required)
        const res = await apiClient.post<{ token: string }>("/auth/dev-login", {
          email: DEV_EMAIL,
          tenantId: tenant,
        });

        if (res?.token) {
          setBearerToken(res.token);
          await AsyncStorage.multiSet([
            [tenantScopedKey, res.token],
            [TENANT_KEY, tenant],
          ]);
          console.log("DevAuthBootstrap: obtained new token", _debugConfig());
          // Update telemetry context
          setTelemetryContext({ tenantId: tenant });
        } else {
          console.warn("DevAuthBootstrap: dev-login returned no token");
        }
      } catch (e) {
        console.error("DevAuthBootstrap error:", e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}
