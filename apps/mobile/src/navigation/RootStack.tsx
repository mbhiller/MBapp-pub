import React from "react";
import { Text, Pressable } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./types";
import { useTheme } from "../providers/ThemeProvider";

// Screens
import ModuleHubScreen from "../screens/ModuleHubScreen";
import ProductsListScreen from "../screens/ProductsListScreen";
import ProductDetailScreen from "../screens/ProductDetailScreen";
import ObjectsListScreen from "../screens/ObjectsListScreen";
import ObjectDetailScreen from "../screens/ObjectDetailScreen";
import TenantsScreen from "../screens/TenantsScreen";
import ScanScreen from "../screens/ScanScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

function HeaderButton({ title, onPress }: { title: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 8 }}>
      <Text style={{ fontWeight: "700", color: t.colors.primary }}>{title}</Text>
    </Pressable>
  );
}

export default function RootStack() {
  const t = useTheme();

  return (
    <Stack.Navigator
      initialRouteName="Hub"
      screenOptions={({ navigation }) => ({
        headerStyle: { backgroundColor: t.colors.headerBg },
        headerTintColor: t.colors.headerText,
        headerTitleStyle: { color: t.colors.headerText, fontWeight: "700" },
        headerRight: () => <HeaderButton title="Scan" onPress={() => navigation.navigate("Scan")} />,
      })}
    >
      <Stack.Screen name="Hub" component={ModuleHubScreen} options={{ title: "Hub" }} />
      <Stack.Screen name="ProductsList" component={ProductsListScreen} options={{ title: "Products" }} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title: "Product" }} />
      <Stack.Screen name="ObjectsList" component={ObjectsListScreen} options={{ title: "Objects" }} />
      <Stack.Screen name="ObjectDetail" component={ObjectDetailScreen} options={{ title: "Object" }} />
      <Stack.Screen name="Tenants" component={TenantsScreen} options={{ title: "Tenants" }} />
      <Stack.Screen name="Scan" component={ScanScreen} options={{ title: "Scan" }} />
    </Stack.Navigator>
  );
}
