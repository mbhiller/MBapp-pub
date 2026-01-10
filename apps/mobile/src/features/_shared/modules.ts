// apps/mobile/src/features/_shared/modules.ts
import { FEATURE_RESERVATIONS_ENABLED, FEATURE_REGISTRATIONS_ENABLED } from "./flags";
import { PERM_INVENTORY_READ } from "../../generated/permissions";

export type ModuleEntry = {
  key: string;
  title: string;
  screen: keyof import("../../navigation/types").RootStackParamList;
  icon?: string;
  required?: string[];
  enabled?: () => boolean;
};

/**
 * Expand policy map with backward-compatible alias keys.
 * API uses singular: party, product, purchase, sales
 * Legacy mobile used plural/compound: parties, products, purchaseorder, salesorder
 */
function expandPolicyWithAliases(policy: Record<string, boolean>): Record<string, boolean> {
  const expanded = { ...policy };
  
  // Alias mappings (both directions)
  const aliases: Array<[string, string]> = [
    ["party", "parties"],
    ["product", "products"],
    ["purchase", "purchaseorder"],
    ["sales", "salesorder"],
  ];

  // For each key in the original policy, add mirrored aliases
  for (const [key, value] of Object.entries(policy)) {
    if (!value) continue; // only expand truthy permissions
    
    const lowerKey = key.toLowerCase();
    for (const [canonical, legacy] of aliases) {
      // If key starts with canonical prefix, add legacy alias
      if (lowerKey.startsWith(canonical + ":")) {
        const suffix = key.slice(canonical.length); // preserves ":read", ":*", etc.
        expanded[legacy + suffix] = value;
      }
      // If key starts with legacy prefix, add canonical alias
      if (lowerKey.startsWith(legacy + ":")) {
        const suffix = key.slice(legacy.length);
        expanded[canonical + suffix] = value;
      }
      // Handle exact matches (no suffix)
      if (lowerKey === canonical) {
        expanded[legacy] = value;
      }
      if (lowerKey === legacy) {
        expanded[canonical] = value;
      }
    }
  }

  return expanded;
}

// helper: case-insensitive policy + wildcard support
function makePolicyMatcher(policy?: Record<string, boolean> | null) {
  if (!policy) {
    // CRITICAL: No policy loaded → deny all (explicit dev bypass available below if needed)
    // If you need a dev-only bypass, use: if (!policy && __DEV__) return (_perm) => true;
    return (_perm: string) => false;
  }

  // Expand policy with backward-compatible aliases before matching
  const expandedPolicy = expandPolicyWithAliases(policy);
  const P = Object.fromEntries(
    Object.entries(expandedPolicy).map(([k, v]) => [k.toLowerCase(), v])
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
  // Policy not loaded yet or empty → return empty (don't show any gated modules)
  if (!policy || Object.keys(policy).length === 0) {
    // Allow dev-only modules to show even without policy
    return MODULES.filter((m) => {
      const enabled = typeof m.enabled === "function" ? m.enabled() : true;
      const devOnly = !m.required || m.required.length === 0; // modules with no requirements
      return enabled && devOnly;
    });
  }

  const can = makePolicyMatcher(policy);
  return MODULES.filter((m) => {
    const allowed = (m.required ?? []).every(can);
    const enabled = typeof m.enabled === "function" ? m.enabled() : true;
    return allowed && enabled;
  });
}

// NOTE: remove the "hub" tile (you land on Hub already)
export const MODULES: readonly ModuleEntry[] = [

  // Domain modules (guarded) - using CANONICAL API permission keys
  // Aliases for legacy keys (parties/products/purchaseorder/salesorder) handled by expandPolicyWithAliases()

  { key: "parties",       title: "Parties",          screen: "PartyList",      icon: "users",           required: ["party:read"] },
  { key: "inventory",     title: "Inventory",        screen: "InventoryList",    icon: "boxes",           required: [PERM_INVENTORY_READ] },
  { key: "products",      title: "Products",         screen: "ProductsList",     icon: "package",         required: ["product:read"] },


  // Purchasing / Sales
  { key: "purchaseOrders", title: "Purchasing",      screen: "PurchaseOrdersList", icon: "cart-arrowdown", required: ["purchase:read"] },
  { key: "salesOrders",    title: "Sales",           screen: "SalesOrdersList",    icon: "cart-plus",      required: ["sales:read"] },
  { key: "backorders",     title: "Backorders",      screen: "BackordersList",     icon: "box",            enabled: () => __DEV__ },

  // Resources (read-only)
  { key: "resources", title: "Resources", screen: "ResourcesList", icon: "box", required: ["resource:read"] },

  // Events (read-only)
  { key: "events", title: "Events", screen: "EventsList", icon: "calendar", required: ["event:read"] },

  // Operational docs
  { key: "routePlans", title: "Route Plans", screen: "RoutePlanList", icon: "truck", required: ["routing:read"] },

  // Sprint III: Workspaces (guarded by workspace:read permission)
  { key: "workspaces", title: "Workspaces", screen: "WorkspaceHub", icon: "folder", required: ["workspace:read"] },

  // Sprint VIII: Reservations (feature-flag + permission)
  { key: "reservations", title: "Reservations", screen: "ReservationsList", icon: "calendar", required: ["reservation:read"], enabled: () => FEATURE_RESERVATIONS_ENABLED },

  // Sprint IV: Registrations (guarded by registration:read permission + feature flag)
  { key: "registrations", title: "Registrations", screen: "RegistrationsList", icon: "calendar", required: ["registration:read"], enabled: () => FEATURE_REGISTRATIONS_ENABLED },

  // Sprint CG: Check-In Scanner (operator-only, requires registration:write for ticket issuance)
  { key: "checkInScanner", title: "Check-In Scanner", screen: "CheckInScanner", icon: "qrcode", required: ["registration:write"], enabled: () => FEATURE_REGISTRATIONS_ENABLED },

  // Dev Tools (Sprint XIII)
  { key: "devtools", title: "Dev Tools", screen: "DevTools", icon: "wrench", enabled: () => __DEV__ },

] as const;

export default MODULES;
