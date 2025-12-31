// apps/mobile/src/providers/DevAuthBootstrap.tsx
import * as React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { View, Pressable, Text, StyleSheet } from "react-native";
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
  const loggedRef = React.useRef(false);
  const [scopedKey, setScopedKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      const envBearer = process.env.MBAPP_BEARER ?? null;
      const hasEnvBearer = Boolean(envBearer);
      const base = getApiBase();
      let tenant = DEV_TENANT;
      let tenantScopedKey = tokenKey(base, tenant);
      // Will be set to true when token is obtained (either from storage or new login) OR env bearer is used
      let tokenSource: "env" | "storage" | "none" = "none";
      let hasFinalToken = false;

      try {
        // 1) Load any stored creds (tenant-aware)
        const storedTenant = await AsyncStorage.getItem(TENANT_KEY);
        tenant = ENV_TENANT || storedTenant || DEV_TENANT;
        tenantScopedKey = tokenKey(base, tenant);
        setScopedKey(tenantScopedKey);
        const [tenantToken, legacyToken] = await Promise.all([
          AsyncStorage.getItem(tenantScopedKey),
          AsyncStorage.getItem(LEGACY_TOKEN_KEY),
        ]);
        let token = tenantToken;
        if (!token && legacyToken) {
          console.log("DevAuthBootstrap: ignoring legacy token; use scoped key", { tenantScopedKey });
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
          hasFinalToken = true;
          tokenSource = "storage";
          // 🔎 Quick probe: verify token still works
          try {
            await apiClient.get("/auth/policy");
            console.log("DevAuthBootstrap: using stored token", _debugConfig());
            // Log the final truth now that we've verified the token
            if (!loggedRef.current) {
              console.log("DevAuthBootstrap: resolved auth", {
                base,
                tenant,
                tokenKey: tenantScopedKey,
                tokenSource,
                hasFinalToken,
                hasEnvBearer,
              });
              loggedRef.current = true;
            }
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
          hasFinalToken = true;
          tokenSource = "storage";
          console.log("DevAuthBootstrap: obtained new token", _debugConfig());
          // Update telemetry context
          setTelemetryContext({ tenantId: tenant });
        } else {
          console.warn("DevAuthBootstrap: dev-login returned no token");
        }
      } catch (e) {
        console.error("DevAuthBootstrap error:", e);
      } finally {
        // Log final truth after all async work + token persistence is complete
        if (!loggedRef.current) {
          console.log("DevAuthBootstrap: resolved auth", {
            base,
            tenant,
            tokenKey: tenantScopedKey,
            tokenSource,
            hasFinalToken,
            hasEnvBearer,
          });
          loggedRef.current = true;
        }
        setReady(true);
      }
    })();
  }, []);

  const handleClearToken = React.useCallback(async () => {
    if (!scopedKey) return;
    try {
      await AsyncStorage.removeItem(scopedKey);
      await AsyncStorage.removeItem(TENANT_KEY);
      setBearerToken(null);
      console.log("DevAuthBootstrap: cleared token for current base/tenant", { tokenKey: scopedKey });
    } catch (e) {
      console.warn("DevAuthBootstrap: failed to clear token", e);
    }
  }, [scopedKey]);

  if (!ready) return null;
  return (
    <View style={{ flex: 1 }}>
      {__DEV__ && scopedKey && (
        <Pressable style={styles.devClearBtn} onPress={handleClearToken}>
          <Text style={styles.devClearText}>Clear token</Text>
        </Pressable>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  devClearBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    zIndex: 9999,
  },
  devClearText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
});
