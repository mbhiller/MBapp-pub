// apps/mobile/App.tsx
import "react-native-gesture-handler";
import React from "react";
import { Pressable, Text as RNText } from "react-native";
import { Provider as PaperProvider } from "react-native-paper";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import TenantsScreen from "./src/features/tenants/TenantsScreen";
import ObjectsListScreen from "./src/screens/ObjectsListScreen";
import ObjectDetailScreen from "./src/screens/ObjectDetailScreen";
import ScanScreen from "./src/screens/ScanScreen";

const Stack = createNativeStackNavigator();
const qc = new QueryClient();

function ScanButton({ navigation }: { navigation: any }) {
  return (
    <Pressable onPress={() => navigation.navigate("Scan")} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
      <RNText style={{ fontWeight: "600" }}>Scan</RNText>
    </Pressable>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <PaperProvider>
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen
              name="Tenants"
              component={TenantsScreen}
              options={({ navigation }) => ({
                title: "Tenants",
                headerRight: () => <ScanButton navigation={navigation} />,
              })}
            />
            <Stack.Screen name="Objects" component={ObjectsListScreen} options={{ title: "Objects" }} />
            <Stack.Screen name="ObjectDetail" component={ObjectDetailScreen} options={{ title: "Object Detail" }} />
            <Stack.Screen name="Scan" component={ScanScreen} options={{ title: "Scan" }} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </QueryClientProvider>
  );
}
