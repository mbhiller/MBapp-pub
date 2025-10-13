// apps/mobile/src/navigation/RootStack.tsx
import React from "react";
import SignOutButton from "../features/dev/SignOutButton";
import { Text, Pressable } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./types";
import { useTheme } from "../providers/ThemeProvider";


// Hub / global
import ModuleHubScreen from "../screens/ModuleHubScreen";
import TenantsScreen from "../screens/TenantsScreen";


// Products
import ProductsListScreen from "../screens/ProductsListScreen";
import ProductDetailScreen from "../screens/ProductDetailScreen";

// Objects (management for all object types)
import ObjectsListScreen from "../screens/ObjectsListScreen";
import ObjectDetailScreen from "../screens/ObjectDetailScreen";

// Clients
import ClientsListScreen from "../screens/ClientsListScreen";
import ClientDetailScreen from "../screens/ClientDetailScreen";

// Accounts
import AccountsListScreen from "../screens/AccountsListScreen";
import AccountDetailScreen from "../screens/AccountDetailScreen";

// Inventory
import InventoryListScreen from "../screens/InventoryListScreen";
import InventoryDetailScreen from "../screens/InventoryDetailScreen";

// Events / Registrations
import EventsListScreen from "../screens/EventsListScreen";
import EventDetailScreen from "../screens/EventDetailScreen";
import RegistrationsListScreen from "../screens/RegistrationsListScreen";
import RegistrationDetailScreen from "../screens/RegistrationDetailScreen";

// Reservations
import ReservationsListScreen from "../screens/ReservationsListScreen";
import ReservationDetailScreen from "../screens/ReservationDetailScreen";

// Vendors / Employees
import VendorsListScreen from "../screens/VendorsListScreen";
import VendorDetailScreen from "../screens/VendorDetailScreen";

import EmployeesListScreen from "../screens/EmployeesListScreen";
import EmployeeDetailScreen from "../screens/EmployeeDetailScreen";

// Resources
import ResourcesListScreen from "../screens/ResourcesListScreen";
import ResourceDetailScreen from "../screens/ResourceDetailScreen";

// Purchasing
import PurchaseOrdersListScreen from "../screens/PurchaseOrdersListScreen";
import PurchaseOrderDetailScreen from "../screens/PurchaseOrderDetailScreen";

// Sales
import SalesOrdersListScreen from   "../screens/SalesOrdersListScreen";
import SalesOrderDetailScreen from  "../screens/SalesOrderDetailScreen";

// Integrations
import IntegrationsListScreen from  "../screens/IntegrationsListScreen";
import IntegrationDetailScreen from "../screens/IntegrationDetailScreen";

import OrganizationsListScreen from "../screens/OrganizationsListScreen";
import OrganizationDetailScreen from "../screens/OrganizationDetailScreen";


import GoodsReceiptDetailScreen from "../screens/GoodsReceiptDetailScreen";
import GoodsReceiptsListScreen from "../screens/GoodsReceiptsListScreen";


import SalesFulfillmentDetailScreen from "../screens/SalesFulfillmentDetailScreen";
import SalesFulfillmentsListScreen from "../screens/SalesFulfillmentsListScreen";

import DevDiagnosticsScreen from "../features/dev/DevDiagnosticsScreen";
// optional runs
// import IntegrationRunsListScreen from "../screens/IntegrationRunsListScreen";

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
  })}
      
    >
    
      

      <Stack.Screen name="Hub" component={ModuleHubScreen} options={{ title: "Hub" }} />
      <Stack.Screen name="DevDiagnostics" component={DevDiagnosticsScreen} options={{ title: "Dev Diagnostics" }} />

      {/* Products */}
      <Stack.Screen name="ProductsList" component={ProductsListScreen} options={{ title: "Products" }} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title: "Product" }} />

      {/* Objects (generic manager) */}
      <Stack.Screen name="ObjectsList" component={ObjectsListScreen} options={{ title: "Objects" }} />
      <Stack.Screen name="ObjectDetail" component={ObjectDetailScreen} options={{ title: "Object" }} />

      {/* Tenants */}
      <Stack.Screen name="Tenants" component={TenantsScreen} options={{ title: "Tenants" }} />

      {/* Clients */}
      <Stack.Screen name="ClientsList" component={ClientsListScreen} options={{ title: "Clients" }} />
      <Stack.Screen name="ClientDetail" component={ClientDetailScreen} options={{ title: "Client" }} />

      {/* Accounts */}
      <Stack.Screen name="AccountsList" component={AccountsListScreen} options={{ title: "Accounts" }} />
      <Stack.Screen name="AccountDetail" component={AccountDetailScreen} options={{ title: "Account" }} />

      {/* Inventory */}
      <Stack.Screen name="InventoryList" component={InventoryListScreen} options={{ title: "Inventory" }} />
      <Stack.Screen name="InventoryDetail" component={InventoryDetailScreen} options={{ title: "Inventory Item" }} />

      {/* Events & Registrations */}
      <Stack.Screen name="EventsList" component={EventsListScreen} options={{ title: "Events" }} />
      <Stack.Screen name="EventDetail" component={EventDetailScreen} options={{ title: "Event" }} />
      
      <Stack.Screen name="RegistrationsList" component={RegistrationsListScreen} options={{ title: "Registrations" }} />
      <Stack.Screen name="RegistrationDetail" component={RegistrationDetailScreen} options={{ title: "Registration" }} />

      {/* Reservations */}
      <Stack.Screen name="ReservationsList" component={ReservationsListScreen} options={{ title: "Reservations" }} />
      <Stack.Screen name="ReservationDetail" component={ReservationDetailScreen} options={{ title: "Reservation" }} />

      {/* Vendors / Employees */}
      <Stack.Screen name="VendorsList" component={VendorsListScreen} options={{ title: "Vendors" }} />
      <Stack.Screen name="VendorDetail" component={VendorDetailScreen} options={{ title: "Vendor" }} />
      
      <Stack.Screen name="EmployeesList" component={EmployeesListScreen} options={{ title: "Employees" }} />
      <Stack.Screen name="EmployeeDetail" component={EmployeeDetailScreen} options={{ title: "Employee" }} />

      {/* Resources */}
      <Stack.Screen name="ResourcesList" component={ResourcesListScreen} options={{ title: "Resources" }} />
      <Stack.Screen name="ResourceDetail" component={ResourceDetailScreen} options={{ title: "Resource" }} />

  
      <Stack.Screen name="PurchaseOrdersList" component={PurchaseOrdersListScreen} options={{ title: "Purchasing" }} />
      <Stack.Screen name="PurchaseOrderDetail" component={PurchaseOrderDetailScreen} options={{ title: "Purchase Order" }} />

      <Stack.Screen name="SalesOrdersList" component={SalesOrdersListScreen} options={{ title: "Sales" }} />
      <Stack.Screen name="SalesOrderDetail" component={SalesOrderDetailScreen} options={{ title: "Sales Order" }} />


      <Stack.Screen name="GoodsReceiptDetail" component={GoodsReceiptDetailScreen} options={{ title: "Goods Receipt" }} />
      <Stack.Screen name="GoodsReceiptsList" component={GoodsReceiptsListScreen} options={{ title: "Goods Receipt" }} />
      

      <Stack.Screen name="SalesFulfillmentDetail" component={SalesFulfillmentDetailScreen} options={{ title: "Sales Fulfillment" }} />
      <Stack.Screen name="SalesFulfillmentsList" component={SalesFulfillmentsListScreen} options={{ title: "Sales Fulfillment" }} />

      <Stack.Screen name="IntegrationsList" component={IntegrationsListScreen} options={{ title: "Integrations" }} />
      <Stack.Screen name="IntegrationDetail" component={IntegrationDetailScreen} options={{ title: "Integration" }} />
      
      <Stack.Screen name="OrganizationsList" component={OrganizationsListScreen} options={{ title: "Organizations" }}/>
      <Stack.Screen name="OrganizationDetail" component={OrganizationDetailScreen} options={{ title: "Organization" }}
/>
    {/* <Stack.Screen name="IntegrationRunsList" component={IntegrationRunsListScreen} options={{ title: "Runs" }} /> */}
    </Stack.Navigator>
  );
}

