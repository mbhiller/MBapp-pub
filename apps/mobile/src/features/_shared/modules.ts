// apps/mobile/src/features/_shared/modules.ts
// Hub modules registry
// NOTE: The RootStack param types are imported via a *relative* type-only import.

export type ModuleEntry = {
  key: string;
  title: string;
  screen: keyof import("../../navigation/types").RootStackParamList;
  icon?: string;        // optional; match whatever your icon system expects
  required?: string[];  // optional permission/role keys (all must be truthy in policy)
};

/**
 * Given the auth policy (e.g., GET /auth/policy), return only modules the user can access.
 * Expected shape: Record<string, boolean> where keys look like "inventory:read", "product:write", etc.
 */
export function visibleModules(policy?: Record<string, boolean> | null): readonly ModuleEntry[] {
  if (!policy) return MODULES;
  return MODULES.filter((m) => (m.required ?? []).every((perm) => policy[perm]));
}

export const MODULES: readonly ModuleEntry[] = [
  // Core / global (no perms required)
  { key: "hub",           title: "Hub",              screen: "Hub",              icon: "grid" },
  { key: "tenants",       title: "Tenants",          screen: "Tenants",          icon: "building" },
  { key: "scan",          title: "Scan",             screen: "Scan",             icon: "qrcode" },
  { key: "devdiagnostics",title: "Dev Dx",screen: "DevDiagnostics",  icon: "wrench" },
 

  // Generic manager (usually broad read; leave unguarded so it stays a power-tool)
  { key: "objects",       title: "Objects",          screen: "ObjectsList",      icon: "database" },

  // Domain modules (guarded by object read perms)
  { key: "products",      title: "Products",         screen: "ProductsList",     icon: "package",         required: ["product:read"] },
  { key: "clients",       title: "Clients",          screen: "ClientsList",      icon: "users",           required: ["client:read"] },
  { key: "accounts",      title: "Accounts",         screen: "AccountsList",     icon: "book",            required: ["account:read"] },
  { key: "inventory",     title: "Inventory",        screen: "InventoryList",    icon: "boxes",           required: ["inventory:read"] },
  { key: "events",        title: "Events",           screen: "EventsList",       icon: "calendar",        required: ["event:read"] },
  { key: "registrations", title: "Registrations",    screen: "RegistrationsList",icon: "id-badge",        required: ["registration:read"] },
  { key: "reservations",  title: "Reservations",     screen: "ReservationsList", icon: "clock",           required: ["reservation:read"] },
  { key: "resources",     title: "Resources",        screen: "ResourcesList",    icon: "warehouse",       required: ["resource:read"] },
  { key: "vendors",       title: "Vendors",          screen: "VendorsList",      icon: "store",           required: ["vendor:read"] },
  { key: "employees",     title: "Employees",        screen: "EmployeesList",    icon: "user-tie",        required: ["employee:read"] },

  // Purchasing / Sales
  // Note: permission keys align with your router's `${type}:read` mapping (type lowercased).
  { key: "purchaseOrders", title: "Purchasing",      screen: "PurchaseOrdersList", icon: "cart-arrowdown", required: ["purchaseorder:read"] },
  { key: "salesOrders",    title: "Sales",           screen: "SalesOrdersList",    icon: "cart-plus",      required: ["salesorder:read"] },

  // Integrations
  { key: "integrations",   title: "Integrations",    screen: "IntegrationsList",   icon: "plug",           required: ["integration:read"] },
] as const;

export default MODULES;
