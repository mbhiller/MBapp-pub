// apps/mobile/src/shared/modules.ts
export type ModuleKey = "products" | "events" | "objects" | "tenants";
export type Role =
  | "products.view" | "products.edit"
  | "events.view"   | "events.edit"
  | "registrations.view" | "registrations.edit"
  | "objects.view"  | "objects.edit"
  | "tenants.view";

export type ModuleDef = {
  key: ModuleKey;
  title: string;
  screen: string;          // RootStack route name
  required: Role[];        // any one role grants access
};

export const MODULES: ModuleDef[] = [
  { key: "products", title: "Products",      screen: "ProductsList",     required: ["products.view"] },
  { key: "events",   title: "Events",        screen: "EventsList",       required: ["events.view"] },
  { key: "objects",  title: "Objects",       screen: "ObjectsList",      required: ["objects.view"] },
  { key: "tenants",  title: "Tenants",       screen: "Tenants",          required: ["tenants.view"] },
];

export const MODULES_BY_KEY = Object.fromEntries(
  MODULES.map(m => [m.key, m])
) as Record<ModuleKey, ModuleDef>;
