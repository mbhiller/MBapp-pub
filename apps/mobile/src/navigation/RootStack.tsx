// apps/mobile/src/navigation/RootStack.tsx
import React from "react";
import SignOutButton from "../features/dev/SignOutButton";
import { Text, Pressable } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./types";
import { useTheme } from "../providers/ThemeProvider";


// Hub / global
import ModuleHubScreen from "../screens/ModuleHubScreen";

// Workspaces
import WorkspaceHubScreen from "../screens/WorkspaceHubScreen";

// Registrations (Sprint IV)
import RegistrationsListScreen from "../screens/RegistrationsListScreen";
import RegistrationDetailScreen from "../screens/RegistrationDetailScreen";

// Reservations (Sprint V)
import ReservationsListScreen from "../screens/ReservationsListScreen";
import ReservationDetailScreen from "../screens/ReservationDetailScreen";

import CreateReservationScreen from "../screens/CreateReservationScreen";
import EditReservationScreen from "../screens/EditReservationScreen";

// Inventory
import PartyListScreen from "../screens/PartyListScreen";
import PartyDetailScreen from "../screens/PartyDetailScreen";
// Inventory
import InventoryListScreen from "../screens/InventoryListScreen";
import InventoryDetailScreen from "../screens/InventoryDetailScreen";
import ResourcesListScreen from "../screens/ResourcesListScreen";
import ResourceDetailScreen from "../screens/ResourceDetailScreen";

// Events (Sprint IX)
import EventsListScreen from "../screens/EventsListScreen";
import EventDetailScreen from "../screens/EventDetailScreen";


// Purchasing
import PurchaseOrdersListScreen from "../screens/PurchaseOrdersListScreen";
import PurchaseOrderDetailScreen from "../screens/PurchaseOrderDetailScreen";

// Sales
import SalesOrdersListScreen from   "../screens/SalesOrdersListScreen";
import SalesOrderDetailScreen from  "../screens/SalesOrderDetailScreen";

import RoutePlanListScreen from "../screens/RoutePlanListScreen";
import RoutePlanDetailScreen from "../screens/RoutePlanDetailScreen";


const Stack = createNativeStackNavigator<RootStackParamList>();

function HeaderButton({ title, onPress }: { title: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
      <Text style={{ color: t.colors.primary, fontWeight: "700" }}>{title}</Text>
    </Pressable>
  );
}

export default function RootStack() {
  const t = useTheme();
  return (
    <Stack.Navigator
      screenOptions={({ navigation }) => ({
    headerRight: () => (
      <>
        {/*<HeaderButton title="Scan" onPress={() => navigation.navigate("Scan")} />*/}
        <SignOutButton />
      </>
    ),
  })}>
    
    <Stack.Screen name="Hub" component={ModuleHubScreen} options={{ title: "Hub" }} />
    
    {/* Workspaces (Sprint III) */}
    <Stack.Screen name="WorkspaceHub" component={WorkspaceHubScreen} options={{ title: "Workspaces" }} />
    
    {/* Registrations (Sprint IV) */}
    <Stack.Screen name="RegistrationsList" component={RegistrationsListScreen} options={{ title: "Registrations" }} />
    <Stack.Screen name="RegistrationDetail" component={RegistrationDetailScreen} options={{ title: "Registration" }} />
    
    {/* Reservations (Sprint V) */}
    <Stack.Screen name="ReservationsList" component={ReservationsListScreen} options={{ title: "Reservations" }} />
    <Stack.Screen name="ReservationDetail" component={ReservationDetailScreen} options={{ title: "Reservation" }} />
    <Stack.Screen name="CreateReservation" component={CreateReservationScreen} options={{ title: "Create Reservation" }} />
    <Stack.Screen name="EditReservation" component={EditReservationScreen} options={{ title: "Edit Reservation" }} />
    
    {/* Party List */}
    <Stack.Screen name="PartyList" component={PartyListScreen} options={{ title: "Parties" }}/>
    <Stack.Screen name="PartyDetail" component={PartyDetailScreen} options={{ title: "Party" }}/>
    
    {/* Inventory */}
    <Stack.Screen name="InventoryList" component={InventoryListScreen} options={{ title: "Inventory" }} />
    <Stack.Screen name="InventoryDetail" component={InventoryDetailScreen} options={{ title: "Inventory Item" }} />

    {/* Resources */}
    <Stack.Screen name="ResourcesList" component={ResourcesListScreen} options={{ title: "Resources" }} />
    <Stack.Screen name="ResourceDetail" component={ResourceDetailScreen} options={{ title: "Resource" }} />

    {/* Events (Sprint IX) */}
    <Stack.Screen name="EventsList" component={EventsListScreen} options={{ title: "Events" }} />
    <Stack.Screen name="EventDetail" component={EventDetailScreen} options={{ title: "Event" }} />

    {/* Purchase Orders */}
    <Stack.Screen name="PurchaseOrdersList" component={PurchaseOrdersListScreen} options={{ title: "Purchasing" }} />
    <Stack.Screen name="PurchaseOrderDetail" component={PurchaseOrderDetailScreen} options={{ title: "Purchase Order" }} />
    
    {/* Routing and Delivery */}
    <Stack.Screen name="RoutePlanList" component={RoutePlanListScreen} />
    <Stack.Screen name="RoutePlanDetail" component={RoutePlanDetailScreen} />
    
    {/* Sales Orders */}
    <Stack.Screen name="SalesOrdersList" component={SalesOrdersListScreen} options={{ title: "Sales" }} />
    <Stack.Screen name="SalesOrderDetail" component={SalesOrderDetailScreen} options={{ title: "Sales Order" }} />

  </Stack.Navigator>
  );
}

