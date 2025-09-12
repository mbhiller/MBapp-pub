import type { RootStackParamList } from "../navigation/types";

export type ModuleKey = "objects" | "products" | "tenants";

export type Role =
  | "objects.view"
  | "products.view"
  | "products.edit"
  | "tenants.view";

export type ModuleDef = {
  key: ModuleKey;
  title: string;
  route: keyof RootStackParamList;
  /** Roles required to see/open this module. Empty => everyone can see it. */
  required: Role[];
};

export const MODULES: ModuleDef[] = [
  { key: "objects",  title: "Objects",  route: "ObjectsList",  required: ["objects.view"] },
  { key: "products", title: "Products", route: "ProductsList", required: ["products.view"] },
  { key: "tenants",  title: "Tenants",  route: "Tenants",      required: ["tenants.view"] },
];

export const MODULES_BY_KEY: Record<ModuleKey, ModuleDef> = MODULES.reduce(
  (acc, m) => ((acc[m.key] = m), acc),
  {} as Record<ModuleKey, ModuleDef>
);
