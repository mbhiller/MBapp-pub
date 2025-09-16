// apps/mobile/App.tsx
import "react-native-gesture-handler";
import * as React from "react";
import { NavigationContainer } from "@react-navigation/native";
import RootStack from "./src/navigation/RootStack";
import { ThemeProvider } from "./src/providers/ThemeProvider";
import { RolesProvider } from "./src/providers/RolesProvider";

function parseEnvRoles(): string[] {
  const raw = (process.env.EXPO_PUBLIC_ROLES as string) || "objects.view,products.view,tenants.view,events.view";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

export default function App() {
  const initialRoles = React.useMemo(parseEnvRoles, []);
  return (
    <ThemeProvider>
      <RolesProvider initialRoles={initialRoles}>
        <NavigationContainer>
          <RootStack />
        </NavigationContainer>
      </RolesProvider>
    </ThemeProvider>
  );
}
