import { listProducts as _list, updateProduct as _update, getProduct as _get, createProduct as _create, type Product, type ListPage } from "../../api/client";

export type { Product, ListPage };

export const listProducts = _list;
export const getProduct   = _get;
export const updateProduct = _update;
export const createProduct = _create;
