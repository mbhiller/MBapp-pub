// apps/mobile/src/navigation/AppNavigator.tsx
import React from "react";
import { Button, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import ObjectsListScreen from "../screens/ObjectsListScreen";
import ObjectDetailScreen from "../screens/ObjectDetailScreen";
import ScanScreen from "../screens/ScanScreen";
import TenantsScreen from "../features/tenants/TenantsScreen";

// Theme
import { ThemeProvider, useTheme } from "../ui/ThemeProvider";

type RootStackParamList = {
  ObjectsList: { type: string };
  ObjectDetail: { obj: any } | { id: string; type: string } | undefined;
  Scan: undefined;
  Tenants: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function StackWithTheme() {
  const t = useTheme();
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="ObjectsList"
        screenOptions={{
          headerStyle: { backgroundColor: t.card },
          headerTitleStyle: { color: t.text, fontWeight: "800" },
          headerTintColor: t.primary,
        }}
      >
        <Stack.Screen
          name="ObjectsList"
          component={ObjectsListScreen}
          initialParams={{ type: "horse" }}
          options={({ navigation }) => ({
            title: "Horses",
            headerLeft: () => (
              <Button
                title="Tenants"
                color={t.primary}
                onPress={() => navigation.navigate("Tenants")}
              />
            ),
            headerRight: () => (
              <View style={{ flexDirection: "row" }}>
                <Button
                  title="Scan"
                  color={t.primary}
                  onPress={() => navigation.navigate("Scan")}
                />
              </View>
            ),
          })}
        />
        <Stack.Screen name="ObjectDetail" component={ObjectDetailScreen} options={{ title: "Object" }} />
        <Stack.Screen name="Scan" component={ScanScreen} options={{ title: "Scan" }} />
        <Stack.Screen name="Tenants" component={TenantsScreen} options={{ title: "Tenants" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function AppNavigator() {
  return (
    <ThemeProvider>
      <StackWithTheme />
    </ThemeProvider>
  );
}
