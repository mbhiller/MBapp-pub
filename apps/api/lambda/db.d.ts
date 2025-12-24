import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
export declare const OBJECTS_TABLE: string;
export declare const doc: DynamoDBDocumentClient;
export declare function encodeCursor(key?: Record<string, any>): string | undefined;
export declare function decodeCursor(token?: string): any;
export declare function listObjectsByTypeQuery(params: {
    tenant: string;
    type: string;
    limit?: number;
    cursor?: string;
    nameContains?: string;
}): Promise<{
    items: any[];
    nextCursor: string | undefined;
}>;
export declare function getObjectByKey(params: {
    tenant: string;
    type: string;
    id: string;
}): Promise<any>;
export declare function createObject(params: {
    tenant: string;
    type: string;
    body: Partial<{
        id: string;
        name?: string;
        tags?: any;
        createdAt?: number | string;
    }>;
}): Promise<{
    pk: string;
    sk: string;
    id: string;
    tenant: string;
    type: string;
    name: string;
    tags: any;
    createdAt: number;
    updatedAt: number;
    gsi1pk: string;
    gsi1sk: string;
}>;
export declare function updateObject(params: {
    tenant: string;
    type: string;
    id: string;
    patch: Partial<{
        name?: string;
        tags?: any;
    }>;
}): Promise<any>;
export declare function deleteObject(params: {
    tenant: string;
    type: string;
    id: string;
}): Promise<any>;
export type Product = {
    id: string;
    sku: string;
    name: string;
    type: "good" | "service";
    uom: string;
    price: number;
    taxCode?: string;
    tags?: any;
    createdAt?: number;
    updatedAt?: number;
};
/** List products for a tenant (newest first). Supports q (name/sku contains) and sku (exact). */
export declare function listProductsQuery(params: {
    tenant: string;
    limit?: number;
    cursor?: string;
    q?: string;
    sku?: string;
}): Promise<{
    items: Product[];
    nextCursor: string | undefined;
}>;
/** Get product by id (base table) */
export declare function getProductById(params: {
    tenant: string;
    id: string;
}): Promise<Product | null>;
/** Create product; sets gsi1 (list) and gsi2 (sku) */
export declare function createProduct(params: {
    tenant: string;
    body: Partial<{
        id: string;
        sku: string;
        name: string;
        type: "good" | "service";
        uom: string;
        price: number;
        taxCode?: string;
        tags?: any;
        createdAt?: number | string;
    }>;
}): Promise<Product>;
/** Update product (guarded) */
export declare function updateProduct(params: {
    tenant: string;
    id: string;
    patch: Partial<{
        sku?: string;
        name?: string;
        type?: "good" | "service";
        uom?: string;
        price?: number;
        taxCode?: string;
        tags?: any;
    }>;
}): Promise<Product>;
