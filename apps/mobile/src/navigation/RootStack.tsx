import React from "react";
import { View, Pressable, Text } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import ModuleHubScreen from "../screens/ModuleHubScreen";
import ObjectsListScreen from "../screens/ObjectsListScreen";
import ObjectDetailScreen from "../screens/ObjectDetailScreen";
import ProductsListScreen from "../screens/ProductsListScreen";
import ProductDetailScreen from "../screens/ProductDetailScreen";
import TenantsScreen from "../features/tenants/TenantsScreen";
import ScanScreen from "../screens/ScanScreen";

import type { RootStackParamList, ObjectRef } from "./types";
import { useTheme } from "../providers/ThemeProvider";

const Stack = createNativeStackNavigator<RootStackParamList>();

function TextBtn({ title, onPress }: { title: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
      <Text style={{ color: t.colors.primary, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
}
function HeaderButton(props: { title: string; onPress: () => void }) {
  return (
    <View style={{ paddingHorizontal: 4 }}>
      <TextBtn {...props} />
    </View>
  );
}

function extractIdType(ref?: ObjectRef | { obj?: ObjectRef } | { item?: ObjectRef }): { id?: string; type?: string } {
  if (!ref) return {};
  const anyRef: any = ref;
  if (anyRef.id && anyRef.type) return { id: anyRef.id, type: anyRef.type };
  if (anyRef.obj?.id && anyRef.obj?.type) return { id: anyRef.obj.id, type: anyRef.obj.type };
  if (anyRef.item?.id && anyRef.item?.type) return { id: anyRef.item.id, type: anyRef.item.type };
  return {};
}

function ThemeToggleButton() {
  const { mode, toggleTheme } = useTheme();
  return <TextBtn title={mode === "light" ? "Dark" : "Light"} onPress={toggleTheme} />;
}

export default function RootStackNavigator() {
  const t = useTheme();

  return (
    <Stack.Navigator
      initialRouteName="Hub"
      screenOptions={{
        headerStyle: { backgroundColor: t.colors.headerBg },
        headerTintColor: t.colors.headerText,
        contentStyle: { backgroundColor: t.colors.bg },
      }}
    >
      <Stack.Screen
        name="Hub"
        component={ModuleHubScreen as any}
        options={({ navigation }: any) => ({
          title: "Hub",
          headerRight: () => (
            <View style={{ flexDirection: "row" }}>
              <ThemeToggleButton />
              <HeaderButton title="Scan" onPress={() => navigation.navigate("Scan")} />
            </View>
          ),
        })}
      />
      <Stack.Screen
        name="Objects"
        component={ObjectsListScreen as any}
        options={({ navigation }: any) => ({
          title: "Objects",
          headerLeft: () => (
            <View style={{ flexDirection: "row" }}>
              <HeaderButton title="Modules" onPress={() => navigation.navigate("Hub")} />
              <HeaderButton title="Tenants" onPress={() => navigation.navigate("Tenants")} />
            </View>
          ),
          headerRight: () => (
            <View style={{ flexDirection: "row" }}>
              <ThemeToggleButton />
              <HeaderButton title="Scan" onPress={() => navigation.navigate("Scan")} />
            </View>
          ),
        })}
      />
      <Stack.Screen
        name="ObjectDetail"
        component={ObjectDetailScreen as any}
        options={({ route, navigation }: any) => {
          const { id, type } = extractIdType(route?.params);
          return {
            title: "Object Detail",
            headerLeft: () => <HeaderButton title="Modules" onPress={() => navigation.navigate("Hub")} />,
            headerRight: () => (
              <View style={{ flexDirection: "row" }}>
                <ThemeToggleButton />
                {id && type
                  ? <HeaderButton title="Scan" onPress={() => navigation.navigate("Scan", { attachTo: { id, type } })} />
                  : <HeaderButton title="Scan" onPress={() => navigation.navigate("Scan")} />
                }
              </View>
            ),
          };
        }}
      />
      <Stack.Screen
        name="Products"
        component={ProductsListScreen as any}
        options={({ navigation }: any) => ({
          title: "Products",
          headerLeft: () => (
            <View style={{ flexDirection: "row" }}>
              <HeaderButton title="Modules" onPress={() => navigation.navigate("Hub")} />
              <HeaderButton title="Tenants" onPress={() => navigation.navigate("Tenants")} />
            </View>
          ),
          headerRight: () => (
            <View style={{ flexDirection: "row" }}>
              <ThemeToggleButton />
              <HeaderButton title="Scan" onPress={() => navigation.navigate("Scan")} />
            </View>
          ),
        })}
      />
      <Stack.Screen
        name="ProductDetail"
        component={ProductDetailScreen as any}
        options={({ navigation }: any) => ({
          title: "Product Detail",
          headerLeft: () => <HeaderButton title="Modules" onPress={() => navigation.navigate("Hub")} />,
          headerRight: () => (
            <View style={{ flexDirection: "row" }}>
              <ThemeToggleButton />
              <HeaderButton title="Scan" onPress={() => navigation.navigate("Scan")} />
            </View>
          ),
        })}
      />
      <Stack.Screen
        name="Tenants"
        component={TenantsScreen as any}
        options={({ navigation }: any) => ({
          title: "Tenants",
          headerLeft: () => <HeaderButton title="Modules" onPress={() => navigation.navigate("Hub")} />,
          headerRight: () => (
            <View style={{ flexDirection: "row" }}>
              <ThemeToggleButton />
              <HeaderButton title="Scan" onPress={() => navigation.navigate("Scan")} />
            </View>
          ),
        })}
      />
      <Stack.Screen
        name="Scan"
        component={ScanScreen as any}
        options={({ navigation }: any) => ({
          title: "Scan",
          presentation: "fullScreenModal",
          headerLeft: () => <HeaderButton title="Close" onPress={() => navigation.goBack()} />,
          headerRight: () => <ThemeToggleButton />,
        })}
      />
    </Stack.Navigator>
  );
}
