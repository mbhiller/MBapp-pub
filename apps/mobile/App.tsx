import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import RootStack from "./src/navigation/RootStack";
import { RolesProvider } from "./src/providers/RolesProvider";
import { ThemeProvider } from "./src/providers/ThemeProvider";

export default function App() {
  return (
    <ThemeProvider>
      <RolesProvider>
        <NavigationContainer>
          <RootStack />
        </NavigationContainer>
      </RolesProvider>
    </ThemeProvider>
  );
}
