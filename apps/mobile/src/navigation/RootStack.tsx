// apps/mobile/src/navigation/RootStack.tsx
import React from "react";
import { Pressable, Text as RNText } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import ObjectsListScreen from "../screens/ObjectsListScreen";
import ObjectDetailScreen from "../screens/ObjectDetailScreen";
import ScanScreen from "../screens/ScanScreen";
import TenantsScreen from "../features/tenants/TenantsScreen";
import { useTheme } from "../ui/ThemeProvider";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

function HeaderTextButton({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
      <RNText style={{ fontWeight: "700", color: t.primary }}>{title}</RNText>
    </Pressable>
  );
}

export function RootStackNavigator() {
  const t = useTheme();
  return (
    <Stack.Navigator
      initialRouteName="Objects"
      screenOptions={{
        headerStyle: { backgroundColor: t.card },
        headerTitleStyle: { color: t.text, fontWeight: "800" },
        headerTintColor: t.primary,
      }}
    >
      <Stack.Screen
        name="Objects"
        component={ObjectsListScreen}
        options={({ navigation }) => ({
          title: "Objects",
          headerLeft: () => (
            <HeaderTextButton title="Tenants" onPress={() => navigation.navigate("Tenants")} />
          ),
          headerRight: () => (
            <HeaderTextButton title="Scan" onPress={() => navigation.navigate("Scan")} />
          ),
        })}
      />

      <Stack.Screen
        name="ObjectDetail"
        component={ObjectDetailScreen}
        options={{ title: "Object Detail" }}
      />

      {/* Scan as full-screen modal with explicit Close */}
      <Stack.Screen
        name="Scan"
        component={ScanScreen}
        options={({ navigation }) => ({
          title: "Scan",
          presentation: "fullScreenModal",
          headerLeft: () => (
            <HeaderTextButton title="Close" onPress={() => navigation.goBack()} />
          ),
        })}
      />

      <Stack.Screen
        name="Tenants"
        component={TenantsScreen}
        options={{ title: "Tenants" }}
      />
    </Stack.Navigator>
  );
}
