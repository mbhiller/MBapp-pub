import { createObjectHooks } from "../_shared/objectHooks";
import type { Product } from "./types";
export const Products = createObjectHooks<Product>("product");
