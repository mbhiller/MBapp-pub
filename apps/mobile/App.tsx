import "react-native-gesture-handler";
import * as React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import RootStackNavigator from "./src/navigation/RootStack";
import { ThemeProvider } from "./src/providers/ThemeProvider";
import { RolesProvider } from "./src/providers/RolesProvider";

// Create a single QueryClient instance (module-level so it doesn't recreate)
const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <ThemeProvider>
      <RolesProvider>
        <QueryClientProvider client={qc}>
          <NavigationContainer>
            <RootStackNavigator />
          </NavigationContainer>
        </QueryClientProvider>
      </RolesProvider>
    </ThemeProvider>
  );
}
