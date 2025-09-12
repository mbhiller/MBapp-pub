import React from "react";
import { Text, Pressable } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./types";

// Screens
import ModuleHubScreen from "../screens/ModuleHubScreen";
import ProductsListScreen from "../screens/ProductsListScreen";
import ProductDetailScreen from "../screens/ProductDetailScreen";
import ObjectsListScreen from "../screens/ObjectsListScreen";
import ObjectDetailScreen from "../screens/ObjectDetailScreen";
import TenantsScreen from "../features/tenants/TenantsScreen";
import ScanScreen from "../screens/ScanScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

function HeaderButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 8 }}>
      <Text style={{ fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
}

export default function RootStack() {
  return (
    <Stack.Navigator
      initialRouteName="Hub"
      screenOptions={({ navigation }) => ({
        headerRight: () => (
          <HeaderButton title="Scan" onPress={() => navigation.navigate("Scan")} />
        ),
      })}
    >
      <Stack.Screen name="Hub" component={ModuleHubScreen} options={{ title: "Hub" }} />
      <Stack.Screen
        name="ProductsList"
        component={ProductsListScreen}
        options={({ navigation }) => ({
          title: "Products",
          headerRight: () => (
            <>
              <HeaderButton
                title="New"
                onPress={() => navigation.navigate("ProductDetail", { mode: "new" })}
              />
              <HeaderButton title="Scan" onPress={() => navigation.navigate("Scan")} />
            </>
          ),
        })}
      />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title: "Product" }} />
      <Stack.Screen name="ObjectsList" component={ObjectsListScreen} options={{ title: "Objects" }} />
      <Stack.Screen name="ObjectDetail" component={ObjectDetailScreen} options={{ title: "Object" }} />
      <Stack.Screen name="Tenants" component={TenantsScreen} options={{ title: "Tenants" }} />
      <Stack.Screen name="Scan" component={ScanScreen} options={{ title: "Scan" }} />
    </Stack.Navigator>
  );
}
