// apps/mobile/src/features/catalog/api.ts
import { api } from "../../api/client";
export const listProducts  = api.products.list;
export const updateProduct = api.products.update;
export const getProduct    = api.products.get;
