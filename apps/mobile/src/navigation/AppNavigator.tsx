import React from "react";
import { Button } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import ObjectsListScreen from "../screens/ObjectsListScreen";
import ObjectDetailScreen from "../screens/ObjectDetailScreen";
import ScanScreen from "../screens/ScanScreen";

type RootStackParamList = {
  ObjectsList: { type: string };
  ObjectDetail: { obj: any };
  Scan: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="ObjectsList">
        <Stack.Screen
          name="ObjectsList"
          component={ObjectsListScreen}
          initialParams={{ type: "horse" }}
          options={({ navigation }) => ({
            title: "Horses",
            headerRight: () => (
              <Button title="Scan" onPress={() => navigation.navigate("Scan")} />
            ),
          })}
        />
        <Stack.Screen
          name="ObjectDetail"
          component={ObjectDetailScreen}
          options={{ title: "Object" }}
        />
        <Stack.Screen name="Scan" component={ScanScreen} options={{ title: "Scan" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
