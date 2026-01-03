// apps/mobile/App.tsx
import "react-native-gesture-handler";
import * as React from "react";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { setPostHogClient, setScreen } from "./lib/telemetry";
import RootStack from "./navigation/RootStack"
import { ThemeProvider } from "./providers/ThemeProvider";
import { RolesProvider } from "./providers/RolesProvider";
import { PolicyProvider } from "./providers/PolicyProvider";
import { QueryClientProvider } from "@tanstack/react-query";
import { DevAuthBootstrap } from "./providers/DevAuthBootstrap";
import { ToastProvider } from "./features/_shared/Toast";

// ✅ use the shared client
import { queryClient } from "./features/_shared/queryClient";

function parseEnvRoles(): string[] {
  const raw =
    (process.env.EXPO_PUBLIC_ROLES as string) ||
    "objects.view,products.view,tenants.view,events.view";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

export default function App() {
  const initialRoles = React.useMemo(parseEnvRoles, []);
  // Initialize telemetry (guarded; safe no-ops if keys missing)
  React.useEffect(() => {
    const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN as string | undefined;
    if (sentryDsn) {
      try {
        const Sentry = require("@sentry/react-native");
        Sentry.init({ dsn: sentryDsn });
      } catch {}
    }
    const phKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY as string | undefined;
    const phHost = process.env.EXPO_PUBLIC_POSTHOG_HOST as string | undefined;
    if (phKey) {
      try {
        const PostHog = require("posthog-react-native");
        const client = new PostHog(phKey, { host: phHost || "https://app.posthog.com" });
        setPostHogClient(client);
      } catch {}
    }
  }, []);

  const navRef = createNavigationContainerRef();

  return (
    <SafeAreaProvider>
      <ToastProvider>
        <ThemeProvider>
          <RolesProvider initialRoles={initialRoles}>
            <QueryClientProvider client={queryClient}>
              <DevAuthBootstrap>
                <PolicyProvider>
                  <NavigationContainer
                    ref={navRef}
                    onReady={() => {
                      const route = navRef.getCurrentRoute();
                      setScreen(route?.name);
                    }}
                    onStateChange={() => {
                      const route = navRef.getCurrentRoute();
                      setScreen(route?.name);
                    }}
                  >
                    <RootStack />
                  </NavigationContainer>
                </PolicyProvider>
              </DevAuthBootstrap>
            </QueryClientProvider>
          </RolesProvider>
        </ThemeProvider>
      </ToastProvider>
    </SafeAreaProvider>
  );
}
