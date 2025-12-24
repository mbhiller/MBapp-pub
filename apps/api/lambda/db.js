"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.doc = exports.OBJECTS_TABLE = void 0;
exports.encodeCursor = encodeCursor;
exports.decodeCursor = decodeCursor;
exports.listObjectsByTypeQuery = listObjectsByTypeQuery;
exports.getObjectByKey = getObjectByKey;
exports.createObject = createObject;
exports.updateObject = updateObject;
exports.deleteObject = deleteObject;
exports.listProductsQuery = listProductsQuery;
exports.getProductById = getProductById;
exports.createProduct = createProduct;
exports.updateProduct = updateProduct;
// apps/api/src/db.ts
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const crypto_1 = require("crypto");
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
exports.OBJECTS_TABLE = process.env.OBJECTS_TABLE || "mbapp_objects";
const ddb = new client_dynamodb_1.DynamoDBClient({ region: REGION });
exports.doc = lib_dynamodb_1.DynamoDBDocumentClient.from(ddb, {
    marshallOptions: { removeUndefinedValues: true },
    unmarshallOptions: { wrapNumbers: false },
});
/* ------------------------------ cursors ------------------------------ */
function encodeCursor(key) {
    if (!key)
        return undefined;
    return Buffer.from(JSON.stringify(key), "utf8").toString("base64");
}
function decodeCursor(token) {
    if (!token)
        return undefined;
    try {
        return JSON.parse(Buffer.from(token, "base64").toString("utf8"));
    }
    catch {
        return undefined;
    }
}
/* ============================ OBJECTS (existing) ============================ */
async function listObjectsByTypeQuery(params) {
    const Limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
    const ExclusiveStartKey = decodeCursor(params.cursor);
    const ExpressionAttributeNames = { "#g1pk": "gsi1pk" };
    const ExpressionAttributeValues = { ":g1pk": `${params.tenant}|${params.type}` };
    let FilterExpression;
    if (params.nameContains) {
        ExpressionAttributeNames["#name"] = "name";
        ExpressionAttributeValues[":name"] = params.nameContains;
        FilterExpression = "contains(#name, :name)";
    }
    const out = await exports.doc.send(new lib_dynamodb_1.QueryCommand({
        TableName: exports.OBJECTS_TABLE,
        IndexName: "gsi1",
        KeyConditionExpression: "#g1pk = :g1pk",
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        FilterExpression,
        Limit,
        ExclusiveStartKey,
        ScanIndexForward: false,
    }));
    return {
        items: (out.Items ?? []),
        nextCursor: encodeCursor(out.LastEvaluatedKey),
    };
}
async function getObjectByKey(params) {
    const Key = { pk: params.id, sk: `${params.tenant}|${params.type}` };
    const out = await exports.doc.send(new lib_dynamodb_1.GetCommand({ TableName: exports.OBJECTS_TABLE, Key }));
    return out.Item || null;
}
async function createObject(params) {
    const nowMs = Date.now();
    const createdAt = typeof params.body?.createdAt === "number"
        ? params.body.createdAt
        : typeof params.body?.createdAt === "string" && /^\d{13}$/.test(params.body.createdAt)
            ? Number(params.body.createdAt)
            : nowMs;
    const id = params.body?.id || (0, crypto_1.randomUUID)();
    const item = {
        pk: id,
        sk: `${params.tenant}|${params.type}`,
        id,
        tenant: params.tenant,
        type: params.type,
        name: params.body?.name ?? "",
        tags: params.body?.tags ?? null,
        createdAt,
        updatedAt: createdAt,
        gsi1pk: `${params.tenant}|${params.type}`,
        gsi1sk: String(createdAt), // STRING sort key
    };
    await exports.doc.send(new lib_dynamodb_1.PutCommand({
        TableName: exports.OBJECTS_TABLE,
        Item: item,
        ConditionExpression: "attribute_not_exists(pk)",
    }));
    return item;
}
async function updateObject(params) {
    const now = Date.now();
    const Key = { pk: params.id, sk: `${params.tenant}|${params.type}` };
    let UpdateExpression = "SET #updatedAt = :now";
    const ExpressionAttributeNames = { "#updatedAt": "updatedAt" };
    const ExpressionAttributeValues = { ":now": now };
    if (params.patch.name !== undefined) {
        UpdateExpression += ", #name = :name";
        ExpressionAttributeNames["#name"] = "name";
        ExpressionAttributeValues[":name"] = params.patch.name;
    }
    if (params.patch.tags !== undefined) {
        UpdateExpression += ", #tags = :tags";
        ExpressionAttributeNames["#tags"] = "tags";
        ExpressionAttributeValues[":tags"] = params.patch.tags;
    }
    const out = await exports.doc.send(new lib_dynamodb_1.UpdateCommand({
        TableName: exports.OBJECTS_TABLE,
        Key,
        UpdateExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        ReturnValues: "ALL_NEW",
        ConditionExpression: "attribute_exists(pk)", // guard: no upsert
    }));
    return out.Attributes || { id: params.id, type: params.type, tenant: params.tenant, updatedAt: now };
}
async function deleteObject(params) {
    const Key = { pk: params.id, sk: `${params.tenant}|${params.type}` };
    const out = await exports.doc.send(new lib_dynamodb_1.DeleteCommand({
        TableName: exports.OBJECTS_TABLE,
        Key,
        ReturnValues: "ALL_OLD",
    }));
    return out.Attributes || null;
}
function asProduct(item) {
    return {
        id: item.id,
        sku: item.sku ?? "",
        name: item.name ?? "",
        type: (item.type === "service" ? "service" : "good"),
        uom: item.uom ?? "ea",
        price: typeof item.price === "number" ? item.price : Number(item.price ?? 0) || 0,
        taxCode: item.taxCode,
        tags: item.tags,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
    };
}
/** List products for a tenant (newest first). Supports q (name/sku contains) and sku (exact). */
async function listProductsQuery(params) {
    const Limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
    // If sku provided, try GSI2 first (fast exact match if present)
    if (params.sku) {
        const g2 = await exports.doc.send(new lib_dynamodb_1.QueryCommand({
            TableName: exports.OBJECTS_TABLE,
            IndexName: "gsi2",
            KeyConditionExpression: "#g2pk = :g2pk",
            ExpressionAttributeNames: { "#g2pk": "gsi2pk" },
            ExpressionAttributeValues: { ":g2pk": `${params.tenant}|product|sku|${params.sku.toUpperCase()}` },
            Limit,
            ScanIndexForward: false,
        }));
        const items = (g2.Items ?? []).map(asProduct);
        if (items.length > 0)
            return { items, nextCursor: undefined };
        // fallthrough to gsi1 if nothing found
    }
    const ExclusiveStartKey = decodeCursor(params.cursor);
    const ExpressionAttributeNames = { "#g1pk": "gsi1pk" };
    const ExpressionAttributeValues = { ":g1pk": `${params.tenant}|product` };
    let FilterExpression;
    if (params.q) {
        ExpressionAttributeNames["#name"] = "name";
        ExpressionAttributeNames["#sku"] = "sku";
        ExpressionAttributeValues[":q"] = params.q;
        FilterExpression = "contains(#name, :q) OR contains(#sku, :q)";
    }
    if (params.sku && !FilterExpression) {
        ExpressionAttributeNames["#sku"] = "sku";
        ExpressionAttributeValues[":sku"] = params.sku;
        FilterExpression = "#sku = :sku";
    }
    const out = await exports.doc.send(new lib_dynamodb_1.QueryCommand({
        TableName: exports.OBJECTS_TABLE,
        IndexName: "gsi1",
        KeyConditionExpression: "#g1pk = :g1pk",
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        FilterExpression,
        Limit,
        ExclusiveStartKey,
        ScanIndexForward: false,
    }));
    return {
        items: (out.Items ?? []).map(asProduct),
        nextCursor: encodeCursor(out.LastEvaluatedKey),
    };
}
/** Get product by id (base table) */
async function getProductById(params) {
    const Key = { pk: params.id, sk: `${params.tenant}|product` };
    const out = await exports.doc.send(new lib_dynamodb_1.GetCommand({ TableName: exports.OBJECTS_TABLE, Key }));
    return out.Item ? asProduct(out.Item) : null;
}
/** Create product; sets gsi1 (list) and gsi2 (sku) */
async function createProduct(params) {
    const nowMs = Date.now();
    const createdAt = typeof params.body?.createdAt === "number"
        ? params.body.createdAt
        : typeof params.body?.createdAt === "string" && /^\d{13}$/.test(params.body.createdAt)
            ? Number(params.body.createdAt)
            : nowMs;
    const id = params.body?.id || (0, crypto_1.randomUUID)();
    const sku = (params.body?.sku || "").toString().trim();
    const name = (params.body?.name || "").toString().trim();
    const kind = params.body?.type === "service" ? "service" : "good";
    const uom = (params.body?.uom || "ea").toString().trim();
    const price = typeof params.body?.price === "number" ? params.body.price : Number(params.body?.price ?? 0) || 0;
    const item = {
        pk: id,
        sk: `${params.tenant}|product`,
        id,
        tenant: params.tenant,
        type: kind,
        sku,
        name,
        uom,
        price,
        taxCode: params.body?.taxCode,
        tags: params.body?.tags ?? null,
        createdAt,
        updatedAt: createdAt,
        // list
        gsi1pk: `${params.tenant}|product`,
        gsi1sk: String(createdAt),
        // sku lookup (optional)
        gsi2pk: sku ? `${params.tenant}|product|sku|${sku.toUpperCase()}` : undefined,
        gsi2sk: id,
    };
    await exports.doc.send(new lib_dynamodb_1.PutCommand({
        TableName: exports.OBJECTS_TABLE,
        Item: item,
        ConditionExpression: "attribute_not_exists(pk)",
    }));
    return asProduct(item);
}
/** Update product (guarded) */
async function updateProduct(params) {
    const now = Date.now();
    const Key = { pk: params.id, sk: `${params.tenant}|product` };
    let UpdateExpression = "SET #updatedAt = :now";
    const ExpressionAttributeNames = { "#updatedAt": "updatedAt" };
    const ExpressionAttributeValues = { ":now": now };
    const set = (attr, valName, value) => {
        UpdateExpression += `, ${attr} = ${valName}`;
        ExpressionAttributeValues[valName] = value;
    };
    const nameAttr = (k, v) => ((ExpressionAttributeNames[k] = v), k);
    if (params.patch.name !== undefined) {
        const k = nameAttr("#name", "name");
        set(k, ":name", params.patch.name);
    }
    if (params.patch.sku !== undefined) {
        const k = nameAttr("#sku", "sku");
        set(k, ":sku", params.patch.sku);
        // maintain GSI2 for sku lookups
        const k2 = nameAttr("#g2pk", "gsi2pk");
        const k3 = nameAttr("#g2sk", "gsi2sk");
        set(k2, ":g2pk", `${params.tenant}|product|sku|${String(params.patch.sku).toUpperCase()}`);
        set(k3, ":g2sk", params.id);
    }
    if (params.patch.type !== undefined) {
        const k = nameAttr("#type", "type");
        set(k, ":type", params.patch.type === "service" ? "service" : "good");
    }
    if (params.patch.uom !== undefined) {
        const k = nameAttr("#uom", "uom");
        set(k, ":uom", params.patch.uom);
    }
    if (params.patch.price !== undefined) {
        const k = nameAttr("#price", "price");
        set(k, ":price", typeof params.patch.price === "number" ? params.patch.price : Number(params.patch.price || 0) || 0);
    }
    if (params.patch.taxCode !== undefined) {
        const k = nameAttr("#tax", "taxCode");
        set(k, ":tax", params.patch.taxCode);
    }
    if (params.patch.tags !== undefined) {
        const k = nameAttr("#tags", "tags");
        set(k, ":tags", params.patch.tags);
    }
    const out = await exports.doc.send(new lib_dynamodb_1.UpdateCommand({
        TableName: exports.OBJECTS_TABLE,
        Key,
        UpdateExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        ReturnValues: "ALL_NEW",
        ConditionExpression: "attribute_exists(pk)", // guard: no upsert
    }));
    return asProduct(out.Attributes || { ...Key, updatedAt: now });
}
