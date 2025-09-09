// apps/mobile/App.tsx
import "react-native-gesture-handler";
import React from "react";
import { Pressable, Text as RNText } from "react-native";
import { Provider as PaperProvider } from "react-native-paper";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import ObjectsListScreen from "./src/screens/ObjectsListScreen";
import ObjectDetailScreen from "./src/screens/ObjectDetailScreen";
import ScanScreen from "./src/screens/ScanScreen";

const Stack = createNativeStackNavigator();

function ScanButton({ navigation }: { navigation: any }) {
  return (
    <Pressable onPress={() => navigation.navigate("Scan")} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
      <RNText style={{ fontWeight: "600" }}>Scan</RNText>
    </Pressable>
  );
}

export default function App() {
  return (
    <PaperProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="Objects"
            component={ObjectsListScreen}
            options={({ navigation }) => ({
              title: "Objects",
              headerRight: () => <ScanButton navigation={navigation} />,
            })}
          />
          <Stack.Screen name="ObjectDetail" component={ObjectDetailScreen} options={{ title: "Object Detail" }} />
          <Stack.Screen name="Scan" component={ScanScreen} options={{ title: "Scan" }} />
        </Stack.Navigator>
      </NavigationContainer>
    </PaperProvider>
  );
}
