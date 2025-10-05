// apps/mobile/src/providers/DevAuthBootstrap.tsx
import * as React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiClient, setBearerToken, setTenantId, _debugConfig } from "../api/client";

const TOKEN_KEY  = "mbapp.dev.token";
const TENANT_KEY = "mbapp.dev.tenant";

const DEV_EMAIL  = process.env.EXPO_PUBLIC_DEV_EMAIL  || "dev@example.com";
const DEV_TENANT = process.env.EXPO_PUBLIC_TENANT_ID || "DemoTenant";

export function DevAuthBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        // 1) Load any stored creds
        const [storedToken, storedTenant] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(TENANT_KEY),
        ]);
        const tenant = storedTenant || DEV_TENANT;
        setTenantId(tenant);

        if (storedToken) {
          setBearerToken(storedToken);
          // 🔎 Quick probe: verify token still works
          try {
            await apiClient.get("/auth/policy");
            console.log("DevAuthBootstrap: using stored token", _debugConfig());
            setReady(true);
            return;
          } catch (e) {
            console.warn("DevAuthBootstrap: stored token failed, re-login…");
          }
        }

        // 2) Dev login (no auth required)
        const res = await apiClient.post<{ token: string }>("/auth/dev-login", {
          email: DEV_EMAIL,
          tenantId: tenant,
        });

        if (res?.token) {
          setBearerToken(res.token);
          await AsyncStorage.multiSet([
            [TOKEN_KEY, res.token],
            [TENANT_KEY, tenant],
          ]);
          console.log("DevAuthBootstrap: obtained new token", _debugConfig());
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
