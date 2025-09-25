// apps/mobile/src/features/_shared/modules.ts
// Hub modules registry
// NOTE: The RootStack param types are imported via a *relative* type-only import.
export type ModuleEntry = {
  key: string;
  title: string;
  screen: keyof import("../../navigation/types").RootStackParamList;
  icon?: string;        // optional; match whatever your icon system expects
  required?: string[];  // optional permission/role keys
};

export const MODULES: readonly ModuleEntry[] = [
  // Core / global
  { key: "hub",          title: "Hub",            screen: "Hub",              icon: "grid" },
  { key: "tenants",      title: "Tenants",        screen: "Tenants",          icon: "building" },
  { key: "scan",         title: "Scan",           screen: "Scan",             icon: "qrcode" },
  { key: "deveventstools",         title: "Dev Events - Tools",     screen: "DevEventsTools",             icon: "qrcode" },
  // Generic manager
  { key: "objects",      title: "Objects",        screen: "ObjectsList",      icon: "database" },

  // Domain modules
  { key: "products",     title: "Products",       screen: "ProductsList",     icon: "package" },
  { key: "clients",      title: "Clients",        screen: "ClientsList",      icon: "users" },
  { key: "accounts",     title: "Accounts",       screen: "AccountsList",     icon: "book" },
  { key: "inventory",    title: "Inventory",      screen: "InventoryList",    icon: "boxes" },
  { key: "events",       title: "Events",         screen: "EventsList",       icon: "calendar" },
  { key: "registrations",title: "Registrations",  screen: "RegistrationsList",icon: "id-badge" },
  { key: "reservations", title: "Reservations",   screen: "ReservationsList", icon: "clock" },
  { key: "resources",    title: "Resources",      screen: "ResourcesList",    icon: "warehouse" },
  { key: "vendors",      title: "Vendors",        screen: "VendorsList",      icon: "store" },
  { key: "employees",    title: "Employees",      screen: "EmployeesList",    icon: "user-tie" },
  { key: "purchaseOrders", title: "Purchasing",   screen: "PurchaseOrdersList", icon: "cart-arrowdown" },
  { key: "salesOrders",    title: "Sales",        screen: "SalesOrdersList",    icon: "cart-plus" },
  { key: "integrations",   title: "Integrations", screen: "IntegrationsList",   icon: "plug" },
] as const;

export default MODULES;
