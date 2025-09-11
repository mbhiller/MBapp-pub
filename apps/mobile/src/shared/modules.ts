import type { RootStackParamList } from "../navigation/types";

export type Role = "internal" | "inventory" | "catalog" | "admin";
export type ModuleKey = "objects" | "products" | "tenants" | "scan";

type ModuleDef = {
  title: string;
  route: keyof RootStackParamList;
  required: Role[]; // any of these roles allows access
  params?: Record<string, any>;
};

export const MODULES: Record<ModuleKey, ModuleDef> = {
  objects: {
    title: "Objects",
    route: "Objects",
    required: ["internal", "inventory"],
    params: { type: "horse" },
  },
  products: {
    title: "Products",
    route: "Products",
    required: ["internal", "catalog"],
  },
  tenants: {
    title: "Tenants",
    route: "Tenants",
    required: ["admin"],
  },
  scan: {
    title: "Scan",
    route: "Scan",
    required: [], // everyone logged-in can scan
  },
};
