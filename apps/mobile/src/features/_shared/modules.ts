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

  // Domain modules (guarded)

  { key: "parties",       title: "Parties",          screen: "PartyList",      icon: "users",           required: ["parties:read"] },
  { key: "inventory",     title: "Inventory",        screen: "InventoryList",    icon: "boxes",           required: ["inventory:read"] },


  // Purchasing / Sales
  { key: "purchaseOrders", title: "Purchasing",      screen: "PurchaseOrdersList", icon: "cart-arrowdown", required: ["purchaseorder:read"] },
  { key: "salesOrders",    title: "Sales",           screen: "SalesOrdersList",    icon: "cart-plus",      required: ["salesorder:read"] },

  // Operational docs
  { key: "routePlans", title: "Route Plans", screen: "RoutePlanList", icon: "truck", required: ["routing:read"] },

  // Sprint III: Workspaces (guarded by workspace:read permission)
  { key: "workspaces", title: "Workspaces", screen: "WorkspaceHub", icon: "folder", required: ["workspace:read"] },

  // Sprint IV: Registrations (guarded by registration:read permission + feature flag)
  { key: "registrations", title: "Registrations", screen: "RegistrationsList", icon: "calendar", required: ["registration:read"] },

] as const;

export default MODULES;
