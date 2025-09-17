// apps/mobile/App.tsx
import "react-native-gesture-handler";
import * as React from "react";
import { NavigationContainer } from "@react-navigation/native";
import RootStack from "./navigation/RootStack"
import { ThemeProvider } from "./providers/ThemeProvider";
import { RolesProvider } from "./providers/RolesProvider";
import { QueryClientProvider } from "@tanstack/react-query";

// ✅ use the shared client
import { queryClient } from "./providers/queryClient";

function parseEnvRoles(): string[] {
  const raw =
    (process.env.EXPO_PUBLIC_ROLES as string) ||
    "objects.view,products.view,tenants.view,events.view";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

export default function App() {
  const initialRoles = React.useMemo(parseEnvRoles, []);

  return (
    <ThemeProvider>
      <RolesProvider initialRoles={initialRoles}>
        <QueryClientProvider client={queryClient}>
          <NavigationContainer>
            <RootStack />
          </NavigationContainer>
        </QueryClientProvider>
      </RolesProvider>
    </ThemeProvider>
  );
}
