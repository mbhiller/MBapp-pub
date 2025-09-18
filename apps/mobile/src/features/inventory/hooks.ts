import { createObjectHooks } from "../_shared/objectHooks";
import type { InventoryItem } from "./types";
export const Inventory = createObjectHooks<InventoryItem>("product");
