// apps/mobile/src/shared/modules.ts

// Keep Role open so you can add specific literals later without churn.
export type Role = "admin" | "manager" | "staff" | "viewer" | string;

export type ModuleDef = {
  key: string;            // internal id
  title: string;          // card title
  screen: string;         // RootStack route
  required: Role | Role[]; // roles allowed; [] means "allow all"
};

export const MODULES: ModuleDef[] = [
  { key: "clients",       title: "Clients",       screen: "ClientsList",       required: [] },
  { key: "events",        title: "Events",        screen: "EventsList",        required: [] },
  { key: "inventory",     title: "Inventory",     screen: "InventoryList",    required: [] },
  { key: "products",      title: "Products",      screen: "ProductsList",      required: [] },
  { key: "registrations", title: "Registrations", screen: "RegistrationsList", required: [] },
  { key: "resources",     title: "Resources",     screen: "ResourcesList",     required: [] },
  { key: "objects",       title: "Objects (All)", screen: "ObjectsList",       required: ["admin","manager"] },
];
