// apps/mobile/App.tsx
import "react-native-gesture-handler";
import React from "react";
import { Provider as PaperProvider } from "react-native-paper";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";

import { ThemeProvider, useTheme } from "./src/ui/ThemeProvider";
import { RootStackNavigator } from "./src/navigation/RootStack";

function ThemedNavContainer() {
  const t = useTheme();
  const navTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: t.bg,
      card: t.card,
      text: t.text,
      primary: t.primary,
      border: t.border,
    },
  };
  return (
    <NavigationContainer theme={navTheme}>
      <RootStackNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <PaperProvider>
      <ThemeProvider>
        <ThemedNavContainer />
      </ThemeProvider>
    </PaperProvider>
  );
}
