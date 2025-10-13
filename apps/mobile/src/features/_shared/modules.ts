// apps/mobile/src/features/_shared/modules.ts

export type ModuleEntry = {
  key: string;
  title: string;
  screen: keyof import("../../navigation/types").RootStackParamList;
  icon?: string;
  required?: string[];
};

// helper: case-insensitive policy + wildcard support
function makePolicyMatcher(policy?: Record<string, boolean> | null) {
  if (!policy) {
    // no policy -> allow everything
    return (_perm: string) => true;
  }
  const P = Object.fromEntries(
    Object.entries(policy).map(([k, v]) => [k.toLowerCase(), v])
  );

  return (perm: string) => {
    const p = perm.toLowerCase();
    if (P[p]) return true;

    // decompose "<resource>:<action?>"
    const [resource, action = "read"] = p.split(":");

    // allow by wildcards:
    // - "*" (superuser)
    // - "*:*" or "*:all"
    // - "*:<action>" (e.g., *:read)
    // - "<resource>:*" (e.g., product:*)
    if (P["*"] || P["*:*"] || P["*:all"]) return true;
    if (P[`*:${action}`]) return true;
    if (P[`${resource}:*`]) return true;

    return false;
  };
}

/** Given the auth policy map, return only modules the user can access. */
export function visibleModules(policy?: Record<string, boolean> | null): readonly ModuleEntry[] {
  const can = makePolicyMatcher(policy);
  return MODULES.filter((m) => (m.required ?? []).every(can));
}

// NOTE: remove the "hub" tile (you land on Hub already)
export const MODULES: readonly ModuleEntry[] = [
  // Core / global (no perms required)
  { key: "tenants",       title: "Tenants",          screen: "Tenants",          icon: "building" },
  { key: "devdiagnostics",title: "Dev Dx",           screen: "DevDiagnostics",   icon: "wrench" },

  // Power tool (leave unguarded)
  { key: "objects",       title: "Objects",          screen: "ObjectsList",      icon: "database" },

  // Domain modules (guarded)
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
  { key: "organization", title: "Organizations",  screen: "OrganizationsList", icon: "building",  required: ["organization:read"] },

  // Purchasing / Sales
  { key: "purchaseOrders", title: "Purchasing",      screen: "PurchaseOrdersList", icon: "cart-arrowdown", required: ["purchaseorder:read"] },
  { key: "salesOrders",    title: "Sales",           screen: "SalesOrdersList",    icon: "cart-plus",      required: ["salesorder:read"] },

  // Operational docs
  { key: "goodsReceipts",  title: "Goods Receipts",  screen: "GoodsReceiptsList",   icon: "inbox-arrow-down", required: ["goodsreceipt:read"] },
  { key: "SalesFulfillments", title: "Sales Fulfillments", screen: "SalesFulfillmentsList", icon: "truck", required: ["fulfillment:read"] },

  // Integrations
  { key: "integrations",   title: "Integrations",    screen: "IntegrationsList",   icon: "plug",           required: ["integration:read"] },
] as const;

export default MODULES;
