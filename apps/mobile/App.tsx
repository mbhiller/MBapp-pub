import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import RootStack from "./src/navigation/RootStack";
import { RolesProvider } from "./src/providers/RolesProvider";

export default function App() {
  return (
    <RolesProvider>
      <NavigationContainer>
        <RootStack />
      </NavigationContainer>
    </RolesProvider>
  );
}
