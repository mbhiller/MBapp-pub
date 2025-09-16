// apps/mobile/src/shared/modules.ts
import type { RootStackParamList } from "../navigation/types";

/** All role strings we gate on (expand as needed). */
export type Role =
  | "admin"
  | "objects.view"
  | "products.view"
  | "tenants.view"
  | "events.view"
  | "inventory.view";

/** Module definition consumed by RolesProvider (expects `required`). */
export type ModuleDef = {
  key: "products" | "inventory" | "events" | "registrations" | "objects" | "tenants";
  title: string;
  screen: keyof RootStackParamList;
  required: Role | Role[];       // ← IMPORTANT: RolesProvider checks this
  hidden?: boolean;
};

export const MODULES: ModuleDef[] = [
  { key: "products",      title: "Products",      screen: "ProductsList",      required: ["products.view", "admin"] },
  { key: "inventory",     title: "Inventory",     screen: "InventoryList",     required: ["inventory.view", "admin"] },
  { key: "events",        title: "Events",        screen: "EventsList",        required: ["events.view", "admin"] },
  { key: "registrations", title: "Registrations", screen: "RegistrationsList", required: ["events.view", "admin"] },
  { key: "objects",       title: "Objects",       screen: "ObjectsList",       required: ["objects.view", "admin"] },
  { key: "tenants",       title: "Tenants",       screen: "Tenants",           required: ["tenants.view", "admin"] },
];
