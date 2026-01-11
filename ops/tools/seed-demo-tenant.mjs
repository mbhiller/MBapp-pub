#!/usr/bin/env node
/**
 * seed-demo-tenant.mjs — Deterministic demo dataset seeder
 * 
 * Creates a realistic demo dataset (parties, events, products, inventory, registrations, tickets)
 * in a specified tenant. Idempotent and safe by default (no deletes unless explicitly requested).
 * 
 * Usage:
 *   # Seed DemoTenant with today's date
 *   node ops/tools/seed-demo-tenant.mjs
 * 
 *   # Seed SmokeTenant with custom seed string
 *   node ops/tools/seed-demo-tenant.mjs --tenant SmokeTenant --seed 2026-01-show-weekend
 * 
 *   # Verbose output + save summary to file
 *   node ops/tools/seed-demo-tenant.mjs --tenant DemoTenant --verbose --output seed-summary.json
 * 
 *   # Custom API base
 *   node ops/tools/seed-demo-tenant.mjs --api-base https://api.example.com --seed 2026-01-10
 * 
 *   # Show help
 *   node ops/tools/seed-demo-tenant.mjs --help
 */

import process from "process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ============================================================================
// ARG PARSING
// ============================================================================

function parseArgs(argv) {
  const opts = {
    tenant: null,
    seed: null,
    apiBase: null,
    email: "dev@example.com",
    verbose: false,
    output: null,
    allowAnyTenant: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--verbose" || arg === "-v") {
      opts.verbose = true;
    } else if (arg === "--allow-any-tenant") {
      opts.allowAnyTenant = true;
    } else if (arg === "--tenant" && i + 1 < argv.length) {
      opts.tenant = argv[++i];
    } else if (arg.startsWith("--tenant=")) {
      opts.tenant = arg.split("=")[1];
    } else if (arg === "--seed" && i + 1 < argv.length) {
      opts.seed = argv[++i];
    } else if (arg.startsWith("--seed=")) {
      opts.seed = arg.split("=")[1];
    } else if (arg === "--api-base" && i + 1 < argv.length) {
      opts.apiBase = argv[++i];
    } else if (arg.startsWith("--api-base=")) {
      opts.apiBase = arg.split("=")[1];
    } else if (arg === "--email" && i + 1 < argv.length) {
      opts.email = argv[++i];
    } else if (arg.startsWith("--email=")) {
      opts.email = arg.split("=")[1];
    } else if (arg === "--output" && i + 1 < argv.length) {
      opts.output = argv[++i];
    } else if (arg.startsWith("--output=")) {
      opts.output = arg.split("=")[1];
    }
  }

  return opts;
}

function showHelp() {
  console.log(`
seed-demo-tenant.mjs — Deterministic demo dataset seeder

Usage:
  node ops/tools/seed-demo-tenant.mjs [OPTIONS]

Options:
  --tenant TENANT           Tenant to seed (default: DemoTenant)
                            Allowed: DemoTenant, SmokeTenant (use --allow-any-tenant to override)
  --seed SEED               Seed string for determinism (default: YYYY-MM-DD)
  --api-base URL            API base URL (default: MBAPP_API_BASE or https://api.example.com)
  --email EMAIL             Dev email for /auth/dev-login (default: dev@example.com)
  --verbose, -v             Log HTTP requests/responses
  --output FILE             Write JSON summary to FILE (default: stdout)
  --allow-any-tenant        Allow any tenant (bypass allowlist)
  --help, -h                Show this help

Examples:
  node ops/tools/seed-demo-tenant.mjs --tenant DemoTenant --seed 2026-01-10
  node ops/tools/seed-demo-tenant.mjs --tenant SmokeTenant --verbose --output summary.json
  node ops/tools/seed-demo-tenant.mjs --api-base http://localhost:3000
`);
}

// ============================================================================
// UTILITIES
// ============================================================================

function formatYYYYMMDD(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function debugLog(verbose, message) {
  if (verbose) {
    console.log(`[DEBUG] ${message}`);
  }
}

// ============================================================================
// POLLING UTILITY
// ============================================================================

/**
 * Poll a function until it returns { ok: true } or timeout expires.
 */
async function pollUntil(label, fn, { timeoutMs = 10000, intervalMs = 500, backoff = 1 } = {}) {
  const startTime = Date.now();
  let attempt = 0;

  while (Date.now() - startTime < timeoutMs) {
    attempt++;
    try {
      const result = await fn();
      if (result?.ok) {
        return result;
      }
    } catch (err) {
      debugLog(globalThis.__VERBOSE, `${label} attempt ${attempt} failed: ${err?.message}`);
    }

    const elapsedMs = Date.now() - startTime;
    if (elapsedMs >= timeoutMs) break;

    const delayMs = Math.min(intervalMs * Math.pow(backoff, attempt - 1), timeoutMs - elapsedMs);
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return { ok: false };
}

// ============================================================================
// HTTP CLIENT
// ============================================================================

let bearerToken = null;

async function request(method, path, body = null, { headers = {} } = {}) {
  const baseUrl = globalThis.__API_BASE || "https://api.example.com";
  const url = `${baseUrl}${path}`;

  const requestHeaders = {
    "content-type": "application/json",
    "x-tenant-id": globalThis.__TENANT || "DemoTenant",
    "X-Feature-Registrations-Enabled": "true",
    "X-Feature-Stripe-Simulate": "true",
    "X-Feature-Notify-Simulate": "true",
    ...headers,
  };

  if (bearerToken) {
    requestHeaders.authorization = `Bearer ${bearerToken}`;
  }

  globalThis.__VERBOSE && console.log(`[HTTP] ${method} ${url}`);

  const options = {
    method,
    headers: requestHeaders,
  };

  if (body && (method === "POST" || method === "PUT")) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const contentType = response.headers.get("content-type");
    let responseBody = null;

    if (contentType && contentType.includes("application/json")) {
      try {
        responseBody = await response.json();
      } catch {
        responseBody = { _parseError: "Invalid JSON" };
      }
    } else {
      responseBody = await response.text();
    }

    if (!response.ok) {
      const error = new Error(
        `${method} ${path} failed with ${response.status}: ${
          typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody)
        }`
      );
      error.status = response.status;
      error.body = responseBody;
      throw error;
    }

    return { ok: true, status: response.status, body: responseBody };
  } catch (error) {
    if (error.status !== undefined) {
      throw error; // Already formatted
    }
    const err = new Error(`${method} ${path} request failed: ${error.message}`);
    err.cause = error;
    throw err;
  }
}

async function get(path) {
  return request("GET", path);
}

async function post(path, body) {
  return request("POST", path, body);
}

async function put(path, body) {
  return request("PUT", path, body);
}

// ============================================================================
// PARTY HELPERS
// ============================================================================

/**
 * List parties from the API (scan up to limit).
 * Returns { items: [...], ok: boolean }
 */
async function listParties(limit = 100) {
  try {
    // Try direct list endpoint first
    const res = await get(`/objects/party?limit=${limit}`);
    if (res.ok && Array.isArray(res.body?.items)) {
      return { ok: true, items: res.body.items };
    }
    // Fallback: try wrapped body
    if (res.ok && Array.isArray(res.body)) {
      return { ok: true, items: res.body };
    }
    return { ok: false, items: [] };
  } catch (error) {
    debugLog(globalThis.__VERBOSE, `listParties failed: ${error.message}`);
    return { ok: false, items: [] };
  }
}

/**
 * Find party by exact name match.
 * Returns party object or null.
 */
async function findPartyByName(targetName) {
  try {
    const result = await listParties(200);
    if (!result.ok) return null;
    return result.items.find((p) => p?.name === targetName) || null;
  } catch {
    return null;
  }
}

/**
 * Create a new party.
 * Returns { id, kind, name, type, roles } or throws.
 */
async function createParty({ name, kind, roles = [] }) {
  debugLog(globalThis.__VERBOSE, `Creating party: ${name} (kind: ${kind})`);

  const payload = {
    type: "party",
    kind,
    name,
    ...(Array.isArray(roles) && roles.length ? { roles } : {}),
  };

  const res = await post("/objects/party", payload);
  if (!res.ok) {
    throw new Error(`Failed to create party '${name}': ${JSON.stringify(res.body)}`);
  }

  const partyId = res.body?.id || res.body?.partyId;
  if (!partyId) {
    throw new Error(`Party created but no ID returned: ${JSON.stringify(res.body)}`);
  }

  return {
    id: partyId,
    type: "party",
    kind,
    name,
    roles: Array.isArray(roles) ? [...roles] : [],
  };
}

/**
 * Add a role to an existing party.
 * Returns updated party or throws.
 */
async function addRoleToParty(partyId, role) {
  debugLog(globalThis.__VERBOSE, `Adding role '${role}' to party ${partyId}`);

  // Fetch current party
  const currentRes = await get(`/objects/party/${encodeURIComponent(partyId)}`);
  if (!currentRes.ok) {
    throw new Error(`Failed to fetch party ${partyId}: ${JSON.stringify(currentRes.body)}`);
  }

  const current = currentRes.body || {};
  const existingRoles = Array.isArray(current.roles) ? [...current.roles] : [];

  // Check if role already present
  if (existingRoles.includes(role)) {
    debugLog(globalThis.__VERBOSE, `Party ${partyId} already has role '${role}'`);
    return current;
  }

  // Add role and update
  const updatedRoles = [...existingRoles, role];
  const updatePayload = {
    ...current,
    type: current.type || "party",
    roles: updatedRoles,
  };

  const updateRes = await put(`/objects/party/${encodeURIComponent(partyId)}`, updatePayload);
  if (!updateRes.ok) {
    throw new Error(`Failed to update party ${partyId}: ${JSON.stringify(updateRes.body)}`);
  }

  return {
    ...current,
    roles: updatedRoles,
  };
}

/**
 * Upsert party: create if not exists, add role if missing.
 * Returns { id, kind, name, roles }
 */
async function upsertPartyByName({ name, kind, roles = [] }) {
  debugLog(globalThis.__VERBOSE, `Upserting party: ${name} (kind: ${kind}, roles: [${roles.join(", ")}])`);

  // Check if exists
  const existing = await findPartyByName(name);

  if (existing) {
    debugLog(globalThis.__VERBOSE, `Party '${name}' already exists: ${existing.id}`);

    // Ensure all required roles are present
    const currentRoles = Array.isArray(existing.roles) ? existing.roles : [];
    const missingRoles = roles.filter((r) => !currentRoles.includes(r));

    if (missingRoles.length > 0) {
      debugLog(globalThis.__VERBOSE, `Adding missing roles to ${existing.id}: [${missingRoles.join(", ")}]`);
      for (const role of missingRoles) {
        await addRoleToParty(existing.id, role);
      }
      // Refresh party data
      const refreshRes = await get(`/objects/party/${encodeURIComponent(existing.id)}`);
      if (refreshRes.ok) {
        return refreshRes.body;
      }
    }

    return {
      id: existing.id,
      kind: existing.kind || kind,
      name,
      roles: Array.isArray(existing.roles) ? existing.roles : [],
    };
  }

  // Create new party
  return await createParty({ name, kind, roles });
}

// ============================================================================
// PRODUCT HELPERS
// ============================================================================

/**
 * List products from the API.
 * Returns { items: [...], ok: boolean }
 */
async function listProducts(limit = 100) {
  try {
    const res = await get(`/objects/product?limit=${limit}`);
    debugLog(globalThis.__VERBOSE, `listProducts response: ok=${res.ok}, body type=${typeof res.body}, has items=${Array.isArray(res.body?.items)}`);
    if (res.ok && Array.isArray(res.body?.items)) {
      debugLog(globalThis.__VERBOSE, `listProducts returning ${res.body.items.length} items from body.items`);
      return { ok: true, items: res.body.items };
    }
    if (res.ok && Array.isArray(res.body)) {
      debugLog(globalThis.__VERBOSE, `listProducts returning ${res.body.length} items from body`);
      return { ok: true, items: res.body };
    }
    debugLog(globalThis.__VERBOSE, `listProducts: res.ok=${res.ok}, body=${JSON.stringify(res.body)}`);
    return { ok: false, items: [] };
  } catch (error) {
    debugLog(globalThis.__VERBOSE, `listProducts failed: ${error.message}`);
    return { ok: false, items: [] };
  }
}

/**
 * Find a product by exact SKU.
 * Throws if none or if multiple are found (ambiguity must be resolved upstream).
 */
async function findProductBySku(targetSku) {
  const sku = (targetSku || "").trim();
  if (!sku) {
    throw new Error("findProductBySku: sku is required");
  }

  // List all products and search locally (filter query may not work reliably)
  const result = await listProducts(500);
  if (!result.ok) {
    throw new Error(`Failed to list products when searching for sku '${sku}'`);
  }

  debugLog(globalThis.__VERBOSE, `Found ${result.items.length} products, searching for sku=${sku}`);
  const items = result.items.filter((p) => p.sku === sku);

  if (items.length === 0) {
    // Debug: show what SKUs are available
    const availableSkus = result.items.map((p) => p.sku).filter(Boolean);
    debugLog(globalThis.__VERBOSE, `Available SKUs: ${availableSkus.join(", ")}`);
    throw new Error(`Product with sku '${sku}' not found after conflict`);
  }
  if (items.length > 1) {
    throw new Error(`Multiple products found with sku '${sku}', cannot disambiguate`);
  }

  return items[0];
}

/**
 * Create product or, on SKU conflict, fetch the existing product by SKU.
 * Handles both 409 conflicts and 500s that include the SKU error message.
 * On persistent failure, uses unique SKU to avoid global collision.
 */
async function getOrCreateProductBySku({ name, sku, kind = "good", preferredVendorId }) {
  debugLog(globalThis.__VERBOSE, `Creating product: ${name} (sku: ${sku})`);

  const payload = {
    type: "product",
    kind,
    name,
    sku,
  };

  if (preferredVendorId) {
    payload.preferredVendorId = preferredVendorId;
  }

  const isSkuConflictError = (error) => {
    const status = error?.status;
    const msg = error?.body?.message || error?.message || "";
    if (!msg) return false;
    const hasSkuMsg = msg.toLowerCase().includes("sku already exists");
    return (status === 409 && hasSkuMsg) || (status === 500 && hasSkuMsg);
  };

  try {
    const res = await post("/objects/product", payload);
    const productId = res.body?.id || res.body?.productId;
    if (!productId) {
      throw new Error(`Product created but no ID returned: ${JSON.stringify(res.body)}`);
    }

    return {
      id: productId,
      type: "product",
      kind,
      name,
      sku,
      reused: false,
    };
  } catch (error) {
    debugLog(globalThis.__VERBOSE, `POST /objects/product error: status=${error?.status}, msg=${error?.body?.message || error?.message}`);
    if (!isSkuConflictError(error)) {
      throw error;
    }

    // Conflict path: Try to find by name first (may have been created despite error), then by SKU
    console.log(`[seed-demo-tenant] SKU conflict detected, trying to find existing product: ${sku}`);
    
    try {
      // Try to find by name first (more reliable than SKU list query)
      const byName = await findProductByName(name);
      if (byName) {
        debugLog(globalThis.__VERBOSE, `Found product by name: ${name} → ${byName.id}`);
        return {
          id: byName.id,
          type: byName.type || "product",
          kind: byName.kind || kind,
          name: byName.name || name,
          sku: byName.sku || sku,
          reused: true,
        };
      }
    } catch (err) {
      debugLog(globalThis.__VERBOSE, `Failed to find by name: ${err.message}`);
    }
    
    // Fallback 1: Try by SKU
    try {
      const existing = await findProductBySku(sku);
      return {
        id: existing.id,
        type: existing.type || "product",
        kind: existing.kind || kind,
        name: existing.name || name,
        sku: existing.sku || sku,
        reused: true,
      };
    } catch (err) {
      debugLog(globalThis.__VERBOSE, `Failed to find by SKU: ${err.message}`);
    }
    
    // Fallback 2: Create with unique SKU (tenant-scoped collision avoidance)
    const uniqueSuffix = Math.random().toString(36).substring(2, 7);
    const uniqueSku = `${sku}-${uniqueSuffix}`;
    console.log(`[seed-demo-tenant] ℹ Could not find conflicting product, creating with unique SKU: ${uniqueSku}`);
    
    try {
      const res2 = await post("/objects/product", {
        type: "product",
        kind,
        name,
        sku: uniqueSku,
        preferredVendorId,
      });
      const productId = res2.body?.id || res2.body?.productId;
      if (!productId) {
        throw new Error(`Product created but no ID returned: ${JSON.stringify(res2.body)}`);
      }

      return {
        id: productId,
        type: "product",
        kind,
        name,
        sku: uniqueSku,
        reused: false,
      };
    } catch (err2) {
      console.log(`[seed-demo-tenant] ✗ Failed to create product even with unique SKU: ${err2.message}`);
      throw err2;
    }
  }
}

/**
 * Find product by exact name match.
 */
async function findProductByName(targetName) {
  try {
    const result = await listProducts(200);
    if (!result.ok) return null;
    return result.items.find((p) => p?.name === targetName) || null;
  } catch {
    return null;
  }
}


/**
 * Create a new product.
 */
async function createProduct({ name, sku, kind = "good", preferredVendorId }) {
  return getOrCreateProductBySku({ name, sku, kind, preferredVendorId });
}

/**
 * Upsert product: create if not exists.
 */
async function upsertProductByName({ name, sku, kind = "good", preferredVendorId }) {
  debugLog(globalThis.__VERBOSE, `Upserting product: ${name}`);

  const existing = await findProductByName(name);
  if (existing) {
    debugLog(globalThis.__VERBOSE, `Product '${name}' already exists: ${existing.id}`);
    return {
      id: existing.id,
      type: "product",
      kind: existing.kind || kind,
      name,
      sku: existing.sku || sku,
      reused: true,
    };
  }

  return await createProduct({ name, sku, kind, preferredVendorId });
}

// ============================================================================
// INVENTORY HELPERS
// ============================================================================

/**
 * List inventory items from the API.
 */
async function listInventoryItems(limit = 100) {
  try {
    // Try canonical type first
    let res = await get(`/objects/inventoryItem?limit=${limit}`);
    if (!res.ok) {
      // Fallback to legacy type
      res = await get(`/objects/inventory?limit=${limit}`);
    }
    if (res.ok && Array.isArray(res.body?.items)) {
      return { ok: true, items: res.body.items };
    }
    if (res.ok && Array.isArray(res.body)) {
      return { ok: true, items: res.body };
    }
    return { ok: false, items: [] };
  } catch (error) {
    debugLog(globalThis.__VERBOSE, `listInventoryItems failed: ${error.message}`);
    return { ok: false, items: [] };
  }
}

/**
 * Find inventory item by exact name match.
 */
async function findInventoryItemByName(targetName) {
  try {
    const result = await listInventoryItems(200);
    if (!result.ok) return null;
    return result.items.find((i) => i?.name === targetName) || null;
  } catch {
    return null;
  }
}

/**
 * Get onhand quantity for an inventory item (if endpoint available).
 * Returns qty or null if not available.
 */
async function getOnhandQty(itemId) {
  try {
    const res = await get(`/inventory/${encodeURIComponent(itemId)}/onhand`);
    if (res.ok && res.body?.items && Array.isArray(res.body.items)) {
      return res.body.items[0]?.onHand ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create a new inventory item for a product.
 */
async function createInventoryItem({ name, productId, uom = "ea" }) {
  debugLog(globalThis.__VERBOSE, `Creating inventory item: ${name} (productId: ${productId})`);

  const payload = {
    type: "inventoryItem",
    name,
    productId,
    uom,
  };

  let res = await post("/objects/inventoryItem", payload);
  
  // Fallback to legacy type if needed
  if (!res.ok) {
    debugLog(globalThis.__VERBOSE, `inventoryItem POST failed, trying legacy inventory type`);
    payload.type = "inventory";
    res = await post("/objects/inventory", payload);
  }

  if (!res.ok) {
    throw new Error(`Failed to create inventory item '${name}': ${JSON.stringify(res.body)}`);
  }

  const itemId = res.body?.id || res.body?.itemId;
  if (!itemId) {
    throw new Error(`Inventory item created but no ID returned: ${JSON.stringify(res.body)}`);
  }

  return {
    id: itemId,
    type: "inventoryItem",
    name,
    productId,
    uom,
  };
}

/**
 * Upsert inventory item: create if not exists.
 */
async function upsertInventoryItemForProduct({ name, productId, uom = "ea" }) {
  debugLog(globalThis.__VERBOSE, `Upserting inventory item: ${name}`);

  const existing = await findInventoryItemByName(name);
  if (existing) {
    debugLog(globalThis.__VERBOSE, `Inventory item '${name}' already exists: ${existing.id}`);
    return {
      id: existing.id,
      type: "inventoryItem",
      name,
      productId: existing.productId || productId,
      uom: existing.uom || uom,
    };
  }

  return await createInventoryItem({ name, productId, uom });
}

/**
 * Receive inventory movement (idempotent).
 * Only receives if onhand is 0 or cannot be checked.
 */
async function receiveMovement({ itemId, qty, seed }) {
  debugLog(globalThis.__VERBOSE, `Preparing receive movement: itemId=${itemId}, qty=${qty}`);

  // Check current onhand (if available)
  const currentOnhand = await getOnhandQty(itemId);
  if (currentOnhand !== null && currentOnhand > 0) {
    debugLog(globalThis.__VERBOSE, `Inventory item ${itemId} already has onhand=${currentOnhand}, skipping receive`);
    return { ok: true, skipped: true, itemId, currentOnhand };
  }

  // Create receive movement
  const payload = {
    type: "inventoryMovement",
    itemId,
    action: "receive",
    qty,
    notes: `Seeded qty=${qty} (seed: ${seed})`,
  };

  const res = await post("/objects/inventoryMovement", payload);
  if (!res.ok) {
    throw new Error(`Failed to create receive movement for ${itemId}: ${JSON.stringify(res.body)}`);
  }

  const movementId = res.body?.id || res.body?.movementId;
  if (!movementId) {
    throw new Error(`Movement created but no ID returned: ${JSON.stringify(res.body)}`);
  }

  debugLog(globalThis.__VERBOSE, `✓ Receive movement created: ${movementId} (qty=${qty})`);
  return { ok: true, skipped: false, movementId, itemId, qty };
}

// ============================================================================
// EVENT HELPERS
// ============================================================================

/**
 * List events from the API.
 */
async function listEvents(limit = 100) {
  try {
    const res = await get(`/objects/event?limit=${limit}`);
    if (res.ok && Array.isArray(res.body?.items)) {
      return { ok: true, items: res.body.items };
    }
    if (res.ok && Array.isArray(res.body)) {
      return { ok: true, items: res.body };
    }
    return { ok: false, items: [] };
  } catch (error) {
    debugLog(globalThis.__VERBOSE, `listEvents failed: ${error.message}`);
    return { ok: false, items: [] };
  }
}

/**
 * Find event by exact name match.
 */
async function findEventByName(targetName) {
  try {
    const result = await listEvents(200);
    if (!result.ok) return null;
    return result.items.find((e) => e?.name === targetName) || null;
  } catch {
    return null;
  }
}

/**
 * Create a new event.
 */
async function createEvent({ name, status = "open", startsAt, endsAt, capacity, stallCapacity, stallEnabled, stallUnitAmount }) {
  debugLog(globalThis.__VERBOSE, `Creating event: ${name}`);

  const payload = {
    type: "event",
    name,
    status,
    startsAt,
    endsAt,
    capacity,
    ...(stallEnabled ? { stallEnabled, stallCapacity, stallUnitAmount } : {}),
  };

  const res = await post("/objects/event", payload);
  if (!res.ok) {
    throw new Error(`Failed to create event '${name}': ${JSON.stringify(res.body)}`);
  }

  const eventId = res.body?.id || res.body?.eventId;
  if (!eventId) {
    throw new Error(`Event created but no ID returned: ${JSON.stringify(res.body)}`);
  }

  return {
    id: eventId,
    type: "event",
    name,
    status,
    startsAt,
    endsAt,
    capacity,
    stallEnabled: stallEnabled || false,
    stallCapacity: stallCapacity || null,
    stallUnitAmount: stallUnitAmount || null,
  };
}

/**
 * Upsert event: create if not exists.
 */
async function upsertEventByName({ name, status, startsAt, endsAt, capacity, stallCapacity, stallEnabled, stallUnitAmount }) {
  debugLog(globalThis.__VERBOSE, `Upserting event: ${name}`);

  const existing = await findEventByName(name);
  if (existing) {
    debugLog(globalThis.__VERBOSE, `Event '${name}' already exists: ${existing.id}`);
    return {
      id: existing.id,
      type: "event",
      name,
      status: existing.status || status,
      startsAt: existing.startsAt || startsAt,
      endsAt: existing.endsAt || endsAt,
      capacity: existing.capacity || capacity,
      stallEnabled: existing.stallEnabled || stallEnabled || false,
      stallCapacity: existing.stallCapacity || stallCapacity,
      stallUnitAmount: existing.stallUnitAmount || stallUnitAmount,
    };
  }

  return await createEvent({
    name,
    status,
    startsAt,
    endsAt,
    capacity,
    stallCapacity,
    stallEnabled,
    stallUnitAmount,
  });
}

/**
 * Create a stall resource for an event.
 * Minimal implementation; only if resourceType is available.
 */
async function createStallResource({ eventId, name, qty = 1 }) {
  try {
    debugLog(globalThis.__VERBOSE, `Creating stall resource: ${name} for event ${eventId}`);

    const payload = {
      type: "resource",
      resourceType: "stall",
      name,
      status: "available",
      tags: [`event:${eventId}`, `group:demo-stalls`],
    };

    const res = await post("/objects/resource", payload);
    if (!res.ok) {
      debugLog(globalThis.__VERBOSE, `Stall resource creation failed (non-fatal): ${JSON.stringify(res.body)}`);
      return null;
    }

    const resourceId = res.body?.id || res.body?.resourceId;
    if (resourceId) {
      debugLog(globalThis.__VERBOSE, `✓ Stall resource created: ${resourceId}`);
      return { id: resourceId, name, eventId };
    }
    return null;
  } catch (error) {
    debugLog(globalThis.__VERBOSE, `Stall resource creation error (non-fatal): ${error.message}`);
    return null;
  }
}

/**
 * Helper to extract registration ID from various response shapes.
 * Returns { regId, body } or throws with detailed error.
 */
function extractRegistrationId(body, endpoint) {
  const regId = body?.registrationId ?? body?.registration?.id ?? body?.registration?.registrationId ?? body?.id;
  
  if (!regId) {
    throw new Error(
      `Failed to extract registration ID from ${endpoint} response. Body: ${JSON.stringify(body)}`
    );
  }
  
  return { regId, body };
}

/**
 * Create a public registration for an event.
 * If partyId is provided, uses existing party; otherwise creates/finds party by email.
 */
async function createPublicRegistration({ eventId, email, displayName, partyId }) {
  debugLog(globalThis.__VERBOSE, `Creating public registration: ${email} for event ${eventId}`);

  try {
    const payload = {
      eventId,
    };

    // Prefer explicit partyId to avoid creating duplicate/blank parties
    if (partyId) {
      payload.partyId = partyId;
    } else {
      // Fallback: party lookup/creation by email + name
      payload.party = { email, name: displayName };
    }

    const response = await fetch(`${globalThis.__API_BASE}/registrations:public`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": globalThis.__TENANT_ID,
        ...(globalThis.__BEARER_TOKEN && { authorization: `Bearer ${globalThis.__BEARER_TOKEN}` }),
        ...(globalThis.__FEATURE_HEADERS || {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      const errBody = await response.json().catch(() => ({}));
      console.error(
        `[seed-demo-tenant] POST /registrations:public failed: status ${response.status}, body: ${JSON.stringify(errBody)}`
      );
      throw new Error(`POST /registrations:public returned ${response.status}: ${errText}`);
    }

    const data = await response.json().catch(() => ({}));
    
    const { regId } = extractRegistrationId(data, "/registrations:public");

    debugLog(globalThis.__VERBOSE, `✓ Public registration created: ${regId}`);
    return { id: regId, status: data.status, publicToken: data.publicToken };
  } catch (error) {
    throw error;
  }
}

/**
 * Checkout a registration to reserve capacity.
 */
async function checkoutRegistration({ registrationId, publicToken }) {
  debugLog(globalThis.__VERBOSE, `Checkout registration: ${registrationId}`);

  try {
    const response = await fetch(
      `${globalThis.__API_BASE}/events/registration/${registrationId}:checkout`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": globalThis.__TENANT_ID,
          "authorization": `Bearer ${globalThis.__BEARER_TOKEN}`,
          "idempotency-key": `checkout-${registrationId}-${Date.now()}`,
          ...(publicToken && { "x-mbapp-public-token": publicToken }),
          ...(globalThis.__FEATURE_HEADERS || {}),
        },
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const errText = await response.text().catch(() => "");
      console.error(
        `[seed-demo-tenant] POST /events/registration/:checkout for ${registrationId} failed: status ${response.status}, body: ${JSON.stringify(errBody)}`
      );
      throw new Error(`POST /events/registration/:checkout returned ${response.status}: ${errText}`);
    }

    const data = await response.json().catch(() => ({}));
    debugLog(globalThis.__VERBOSE, `✓ Checkout complete, status: ${data.status}, paymentIntentId: ${data.paymentIntentId}`);
    return { ok: true, status: data.status, paymentIntentId: data.paymentIntentId, eventId: data.eventId };
  } catch (error) {
    throw error;
  }
}

/**
 * Simulate Stripe webhook payment success for a payment intent.
 * This allows registrations to reach confirmed status without waiting for actual webhooks.
 */
async function simulatePaymentSuccess({ paymentIntentId, registrationId, eventId }) {
  debugLog(globalThis.__VERBOSE, `Simulating payment success for PI: ${paymentIntentId}`);

  try {
    // Construct webhook body matching Stripe webhook format
    const webhookBody = {
      id: `evt_seed_${paymentIntentId}`,
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: paymentIntentId,
          status: "succeeded",
          metadata: { registrationId, eventId }
        }
      }
    };

    const response = await fetch(
      `${globalThis.__API_BASE}/webhooks/stripe`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Stripe-Signature": "sim_valid_signature",
          "x-tenant-id": globalThis.__TENANT_ID,
          ...(globalThis.__FEATURE_HEADERS || {}),
        },
        body: JSON.stringify(webhookBody),
      }
    );

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const errText = await response.text().catch(() => "");
      console.error(
        `[seed-demo-tenant] POST /webhooks/stripe failed: status ${response.status}, body: ${JSON.stringify(errBody)}`
      );
      throw new Error(`POST /webhooks/stripe returned ${response.status}: ${errText}`);
    }

    console.log(`[seed-demo-tenant] ✓ Simulated payment success for PI: ${paymentIntentId}`);
    return { ok: true };
  } catch (error) {
    throw error;
  }
}

/**
 * Poll until registration reaches a confirmed status (with payment).
 */
async function pollRegistrationConfirmed(registrationId) {
  debugLog(globalThis.__VERBOSE, `Polling registration ${registrationId} until confirmed...`);

  return await pollUntil(
    `registration-confirmed-${registrationId}`,
    async () => {
      const response = await fetch(`${globalThis.__API_BASE}/registrations/${registrationId}`, {
        headers: {
          "x-tenant-id": globalThis.__TENANT_ID,
          "authorization": `Bearer ${globalThis.__BEARER_TOKEN}`,
          ...(globalThis.__FEATURE_HEADERS || {}),
        },
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        debugLog(globalThis.__VERBOSE, `GET /registrations/${registrationId} failed: ${response.status}, ${JSON.stringify(errBody)}`);
        return { ok: false };
      }

      const reg = await response.json().catch(() => ({}));
      debugLog(globalThis.__VERBOSE, `Registration status: ${reg.status}, paymentStatus: ${reg.paymentStatus}, checkInStatus: ${JSON.stringify(reg.checkInStatus)}`);
      // Check if status is confirmed or if paymentStatus indicates success
      if (reg.status === "confirmed" || reg.paymentStatus === "paid") {
        return { ok: true, registration: reg };
      }

      return { ok: false };
    },
    { timeoutMs: 15000, intervalMs: 500, backoff: 1 }
  );
}

/**
 * Issue a ticket for a registration.
 */
async function issueTicket({ registrationId, idempotencyKey }) {
  debugLog(globalThis.__VERBOSE, `Issuing ticket for registration ${registrationId}`);

  try {
    const response = await fetch(
      `${globalThis.__API_BASE}/registrations/${registrationId}:issue-ticket`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": globalThis.__TENANT_ID,
          "authorization": `Bearer ${globalThis.__BEARER_TOKEN}`,
          "idempotency-key": idempotencyKey,
          ...(globalThis.__FEATURE_HEADERS || {}),
        },
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const errText = await response.text().catch(() => "");
      console.error(
        `[seed-demo-tenant] POST /registrations/:issue-ticket for ${registrationId} failed: status ${response.status}, body: ${JSON.stringify(errBody)}`
      );
      throw new Error(`POST /registrations/:issue-ticket returned ${response.status}: ${errText}`);
    }

    const data = await response.json().catch(() => ({}));
    
    // Parse response: API returns { ticket: Ticket } where Ticket has id and payload.qrText
    const ticket = data?.ticket ?? data?.data?.ticket ?? data?.result?.ticket ?? data;
    const ticketId = ticket?.id;
    const qrText = ticket?.payload?.qrText ?? ticket?.qrText;

    if (!ticketId) {
      throw new Error(`Ticket issued but no ID returned. Response: ${JSON.stringify(data)}`);
    }

    debugLog(globalThis.__VERBOSE, `✓ Ticket issued: ${ticketId}, QR: ${qrText}`);
    return { ticketId, qrText, ticket, status: ticket?.status };
  } catch (error) {
    throw error;
  }
}

/**
 * Resolve a scan (optional, for readiness checking).
 */
async function resolveScan({ scanText }) {
  debugLog(globalThis.__VERBOSE, `Resolving scan: ${scanText}`);

  try {
    const response = await fetch(`${globalThis.__API_BASE}/registrations:resolve-scan`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": globalThis.__TENANT_ID,
        "authorization": `Bearer ${globalThis.__BEARER_TOKEN}`,
        ...(globalThis.__FEATURE_HEADERS || {}),
      },
      body: JSON.stringify({ scanText, scanType: "qr" }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`POST /registrations:resolve-scan returned ${response.status}: ${errText}`);
    }

    const data = await response.json().catch(() => ({}));
    debugLog(globalThis.__VERBOSE, `✓ Scan resolved, readiness: ${JSON.stringify(data)}`);
    return { ok: true, readiness: data };
  } catch (error) {
    debugLog(globalThis.__VERBOSE, `Resolve scan warning (non-fatal): ${error.message}`);
    return { ok: false };
  }
}

/**
 * Check-in a registration (mark attendee present).
 */
async function checkinRegistration({ registrationId, idempotencyKey }) {
  debugLog(globalThis.__VERBOSE, `Checking in registration ${registrationId}`);

  try {
    const response = await fetch(
      `${globalThis.__API_BASE}/events/registration/${registrationId}:checkin`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": globalThis.__TENANT_ID,
          "authorization": `Bearer ${globalThis.__BEARER_TOKEN}`,
          "idempotency-key": idempotencyKey,
          ...(globalThis.__FEATURE_HEADERS || {}),
        },
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const errText = await response.text().catch(() => "");
      console.error(
        `[seed-demo-tenant] POST /events/registration/:checkin for ${registrationId} failed: status ${response.status}, body: ${JSON.stringify(errBody)}`
      );
      return { ok: false, status: response.status, body: errBody };
    }

    const data = await response.json().catch(() => ({}));
    debugLog(globalThis.__VERBOSE, `✓ Check-in complete`);
    return { ok: true, checkedInAt: data.checkedInAt };
  } catch (error) {
    console.error(`[seed-demo-tenant] Check-in request failed: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

/**
 * Use a ticket (mark as used/consumed).
 */
async function useTicket({ ticketId, idempotencyKey }) {
  debugLog(globalThis.__VERBOSE, `Using ticket ${ticketId}`);

  try {
    const response = await fetch(`${globalThis.__API_BASE}/tickets/${ticketId}:use`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": globalThis.__TENANT_ID,
        "authorization": `Bearer ${globalThis.__BEARER_TOKEN}`,
        "idempotency-key": idempotencyKey,
        ...(globalThis.__FEATURE_HEADERS || {}),
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`POST /tickets/:use returned ${response.status}: ${errText}`);
    }

    const data = await response.json().catch(() => ({}));
    debugLog(globalThis.__VERBOSE, `✓ Ticket used`);
    return { ok: true, usedAt: data.usedAt };
  } catch (error) {
    throw error;
  }
}

// ============================================================================
// AUTH
// ============================================================================

async function acquireToken(apiBase, email, tenantId) {
  globalThis.__VERBOSE && console.log(`[auth] Acquiring token via /auth/dev-login...`);

  try {
    const response = await fetch(`${apiBase}/auth/dev-login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": tenantId },
      body: JSON.stringify({ email, tenantId }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`/auth/dev-login returned ${response.status}: ${errText}`);
    }

    const data = await response.json().catch(() => ({}));
    if (!data.token) {
      throw new Error("/auth/dev-login returned no token");
    }

    bearerToken = data.token;
    globalThis.__VERBOSE && console.log(`[auth] Token acquired successfully`);
    return { ok: true, email, tenantId };
  } catch (error) {
    console.error(`[auth] Failed to acquire token: ${error.message}`);
    process.exit(2);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const argv = parseArgs(process.argv.slice(2));

  if (argv.help) {
    showHelp();
    process.exit(0);
  }

  // Defaults
  const tenant = (argv.tenant || process.env.MBAPP_TENANT_ID || "DemoTenant").trim();
  const seed = argv.seed || formatYYYYMMDD();
  const apiBase = (
    argv.apiBase ||
    process.env.MBAPP_API_BASE ||
    process.env.API_BASE ||
    "https://api.example.com"
  ).replace(/\/+$/, "");
  const email = argv.email || "dev@example.com";

  // Global state for HTTP client
  globalThis.__API_BASE = apiBase;
  globalThis.__TENANT = tenant;
  globalThis.__VERBOSE = argv.verbose;

  // Tenant allowlist
  const ALLOWED_TENANTS = new Set(["DemoTenant", "SmokeTenant"]);
  if (!argv.allowAnyTenant && !ALLOWED_TENANTS.has(tenant)) {
    console.error(
      `[seed-demo-tenant] ERROR: tenant '${tenant}' not in allowlist [${Array.from(ALLOWED_TENANTS).join(", ")}]`
    );
    console.error("[seed-demo-tenant] Use --allow-any-tenant to bypass (NOT RECOMMENDED)");
    process.exit(1);
  }

  // Log setup
  console.log(
    JSON.stringify({
      action: "seed-demo-tenant-start",
      tenant,
      seed,
      apiBase,
      email,
      timestamp: new Date().toISOString(),
    })
  );

  // Acquire token
  const authResult = await acquireToken(apiBase, email, tenant);

  // Build dataset skeleton
  const dataset = {
    success: true,
    seed,
    tenant,
    apiBase,
    email,
    createdAt: new Date().toISOString(),
    auth: authResult,
    summary: {
      parties: 0,
      products: 0,
      inventoryItems: 0,
      events: 0,
      resources: 0,
      registrations: 0,
      tickets: 0,
    },
    entities: {
      parties: [],
      products: [],
      inventoryItems: [],
      events: [],
      resources: [],
      registrations: [],
      tickets: [],
    },
  };

  // ========== SEED: Parties ==========
  try {
    console.log(`[seed-demo-tenant] Creating parties...`);

    // 1. Customer party
    const customerName = `Emma Lawson (seed ${seed})`;
    const customer = await upsertPartyByName({
      name: customerName,
      kind: "person",
      roles: ["customer"],
    });
    dataset.entities.parties.push({
      id: customer.id,
      kind: customer.kind,
      name: customer.name,
      roles: customer.roles || [],
    });
    console.log(`[seed-demo-tenant] ✓ Customer party: ${customer.id}`);

    // 2. Vendor party
    const vendorName = `Red Oak Tack & Supply (seed ${seed})`;
    const vendor = await upsertPartyByName({
      name: vendorName,
      kind: "organization",
      roles: ["vendor"],
    });
    dataset.entities.parties.push({
      id: vendor.id,
      kind: vendor.kind,
      name: vendor.name,
      roles: vendor.roles || [],
    });
    console.log(`[seed-demo-tenant] ✓ Vendor party: ${vendor.id}`);

    dataset.summary.parties = dataset.entities.parties.length;
  } catch (error) {
    console.error(`[seed-demo-tenant] Failed to create parties: ${error.message}`);
    process.exit(1);
  }

  // ========== SEED: Products + Inventory + Movements ==========
  try {
    console.log(`[seed-demo-tenant] Creating products and inventory...`);

    // 1. Grounds Pass product + inventory
    const groundsPassProductName = `Weekend Grounds Pass (seed ${seed})`;
    const groundsPassSku = `DEMO-GPASS-${seed.replace(/-/g, "")}`;
    const groundsProduct = await upsertProductByName({
      name: groundsPassProductName,
      sku: groundsPassSku,
      kind: "good",
      preferredVendorId: dataset.entities.parties.find(p => p.roles?.includes("vendor"))?.id || null,
    });
    dataset.entities.products.push({
      id: groundsProduct.id,
      kind: groundsProduct.kind,
      name: groundsProduct.name,
      sku: groundsProduct.sku,
    });
    console.log(
      `[seed-demo-tenant] ✓ Product (Grounds Pass): ${groundsProduct.id} (sku=${groundsProduct.sku}${
        groundsProduct.reused ? ", reused=true" : ""
      })`
    );

    const groundsItemName = `Grounds Pass (QR) (seed ${seed})`;
    const groundsItem = await upsertInventoryItemForProduct({
      name: groundsItemName,
      productId: groundsProduct.id,
      uom: "ea",
    });
    dataset.entities.inventoryItems.push({
      id: groundsItem.id,
      name: groundsItem.name,
      productId: groundsItem.productId,
      uom: groundsItem.uom,
    });
    console.log(`[seed-demo-tenant] ✓ Inventory item (Grounds Pass): ${groundsItem.id}`);

    // Receive 250 units
    const groundsReceive = await receiveMovement({
      itemId: groundsItem.id,
      qty: 250,
      seed,
    });
    if (!groundsReceive.skipped) {
      console.log(`[seed-demo-tenant] ✓ Received 250 Grounds Pass items`);
    } else {
      console.log(`[seed-demo-tenant] ℹ Grounds Pass already has inventory (qty: ${groundsReceive.currentOnhand})`);
    }

    // 2. T-Shirt product + inventory
    const tshirtProductName = `Event T-Shirt (seed ${seed})`;
    const tshirtSku = `DEMO-TSHIRT-${seed.replace(/-/g, "")}`;
    const tshirtProduct = await upsertProductByName({
      name: tshirtProductName,
      sku: tshirtSku,
      kind: "good",
      preferredVendorId: dataset.entities.parties.find(p => p.roles?.includes("vendor"))?.id || null,
    });
    dataset.entities.products.push({
      id: tshirtProduct.id,
      kind: tshirtProduct.kind,
      name: tshirtProduct.name,
      sku: tshirtProduct.sku,
    });
    console.log(
      `[seed-demo-tenant] ✓ Product (T-Shirt): ${tshirtProduct.id} (sku=${tshirtProduct.sku}${
        tshirtProduct.reused ? ", reused=true" : ""
      })`
    );

    const tshirtItemName = `T-Shirt - Unisex (M) (seed ${seed})`;
    const tshirtItem = await upsertInventoryItemForProduct({
      name: tshirtItemName,
      productId: tshirtProduct.id,
      uom: "ea",
    });
    dataset.entities.inventoryItems.push({
      id: tshirtItem.id,
      name: tshirtItem.name,
      productId: tshirtItem.productId,
      uom: tshirtItem.uom,
    });
    console.log(`[seed-demo-tenant] ✓ Inventory item (T-Shirt): ${tshirtItem.id}`);

    // Receive 80 units
    const tshirtReceive = await receiveMovement({
      itemId: tshirtItem.id,
      qty: 80,
      seed,
    });
    if (!tshirtReceive.skipped) {
      console.log(`[seed-demo-tenant] ✓ Received 80 T-Shirt items`);
    } else {
      console.log(`[seed-demo-tenant] ℹ T-Shirt already has inventory (qty: ${tshirtReceive.currentOnhand})`);
    }

    dataset.summary.products = dataset.entities.products.length;
    dataset.summary.inventoryItems = dataset.entities.inventoryItems.length;
  } catch (error) {
    console.error(`[seed-demo-tenant] Failed to create products/inventory: ${error.message}`);
    process.exit(1);
  }

  // ========== SEED: Event ==========
  try {
    console.log(`[seed-demo-tenant] Creating event...`);

    // Calculate dates: start 7 days from now, end 2 days after start
    const now = new Date();
    const startsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const endsAt = new Date(new Date(startsAt).getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();

    const eventName = `Demo Show Weekend (seed ${seed})`;
    const event = await upsertEventByName({
      name: eventName,
      status: "open",
      startsAt,
      endsAt,
      capacity: 250,
      stallCapacity: 120,
      stallEnabled: true,
      stallUnitAmount: 3500, // $35.00 in cents
    });

    dataset.entities.events.push({
      id: event.id,
      name: event.name,
      status: event.status,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      capacity: event.capacity,
      stallEnabled: event.stallEnabled,
      stallCapacity: event.stallCapacity,
      stallUnitAmount: event.stallUnitAmount,
    });
    console.log(`[seed-demo-tenant] ✓ Event: ${event.id}`);

    // Optional: Create a few stall resources (non-fatal if fails)
    const stalls = [];
    for (let i = 1; i <= 3; i++) {
      const stallName = `Demo Stall ${i} (seed ${seed})`;
      const stall = await createStallResource({
        eventId: event.id,
        name: stallName,
      });
      if (stall) {
        stalls.push(stall);
        console.log(`[seed-demo-tenant] ✓ Stall resource: ${stall.id}`);
      }
    }

    dataset.summary.events = dataset.entities.events.length;
    if (stalls.length > 0) {
      dataset.entities.resources = stalls;
      dataset.summary.resources = stalls.length;
    }
  } catch (error) {
    console.error(`[seed-demo-tenant] Failed to create event: ${error.message}`);
    process.exit(1);
  }

  // ========== SEED: Registrations + Tickets ==========
  try {
    console.log(`[seed-demo-tenant] Creating registrations and tickets...`);

    if (dataset.entities.events.length === 0) {
      throw new Error("No event found; cannot create registrations");
    }

    const event = dataset.entities.events[0];
    const eventId = event.id;

    // Use globalThis to expose context to helpers
    globalThis.__API_BASE = apiBase;
    globalThis.__TENANT_ID = tenant;
    globalThis.__BEARER_TOKEN = bearerToken;
    globalThis.__FEATURE_HEADERS = {
      "x-feature-registrations-enabled": "true",
      "x-feature-stripe-simulate": "true",
      "x-feature-notify-simulate": "true",
    };

    // REG 1: demo.reg1+<seed>@example.com — confirmed, ticket, checked-in, used
    {
      const email1 = `demo.reg1+${seed}@example.com`;
      const displayName1 = `Demo Reg 1 (seed ${seed})`;
      const customerPartyId = dataset.entities.parties.find(p => p.roles?.includes("customer"))?.id;

      console.log(`[seed-demo-tenant] Creating registration: ${email1}...`);
      const reg1 = await createPublicRegistration({ eventId, email: email1, displayName: displayName1, partyId: customerPartyId });
      const regId1 = reg1.id;
      const publicToken1 = reg1.publicToken;

      // Checkout
      const checkout1 = await checkoutRegistration({ registrationId: regId1, publicToken: publicToken1 });

      // Simulate payment success via webhook
      if (checkout1.paymentIntentId) {
        await simulatePaymentSuccess({
          paymentIntentId: checkout1.paymentIntentId,
          registrationId: regId1,
          eventId,
        });
      }

      // Poll until confirmed
      const pollResult1 = await pollRegistrationConfirmed(regId1);
      if (!pollResult1.ok) {
        throw new Error(`Registration ${regId1} failed to confirm after checkout`);
      }

      // Check-in BEFORE issuing ticket
      const idempotencyKey1Checkin = `seed-${seed}-reg1-checkin`;
      const checkinResult1 = await checkinRegistration({ registrationId: regId1, idempotencyKey: idempotencyKey1Checkin });
      
      // If check-in failed with blockers, stop here
      if (!checkinResult1.ok) {
        console.warn(`[seed-demo-tenant] Check-in for ${regId1} failed; skipping ticket issuance`);
        throw new Error(`Check-in failed for ${regId1}: ${JSON.stringify(checkinResult1)}`);
      }

      // Issue ticket AFTER successful check-in
      const idempotencyKey1Ticket = `seed-${seed}-reg1-ticket`;
      const ticket1 = await issueTicket({ registrationId: regId1, idempotencyKey: idempotencyKey1Ticket });
      const ticketId1 = ticket1.ticketId;
      const qrText1 = ticket1.qrText;

      // Print ticket info for manual testing
      console.log(`[seed-demo-tenant] REG1 TICKET ID: ${ticketId1}`);
      console.log(`[seed-demo-tenant] REG1 TICKET QR: ${qrText1}`);

      // Validate ticket ID before attempting to use
      if (!ticketId1) {
        throw new Error(`Failed to issue ticket for ${regId1}: no ticket ID returned`);
      }

      // Resolve scan (optional, for readiness)
      if (qrText1) {
        await resolveScan({ scanText: qrText1 });
      }

      // Use ticket
      const idempotencyKey1Use = `seed-${seed}-reg1-use`;
      console.log(`[seed-demo-tenant] Using ticket: ${ticketId1}`);
      const useResult = await useTicket({ ticketId: ticketId1, idempotencyKey: idempotencyKey1Use });

      dataset.entities.registrations.push({
        email: email1,
        displayName: displayName1,
        registrationId: regId1,
        eventId: eventId,
        status: "confirmed",
        paymentStatus: "paid",
        checkedInAt: new Date().toISOString(),
      });

      dataset.entities.tickets.push({
        ticketId: ticketId1,
        registrationId: regId1,
        qrText: qrText1,
        status: "used",
        usedAt: useResult.usedAt || new Date().toISOString(),
      });

      console.log(`[seed-demo-tenant] ✓ Reg1: ${regId1}, Ticket: ${ticketId1} (used)`);
    }

    // REG 2: demo.reg2+<seed>@example.com — confirmed, ticket, NOT checked-in, NOT used
    {
      const email2 = `demo.reg2+${seed}@example.com`;
      const displayName2 = `Demo Reg 2 (seed ${seed})`;
      const customerPartyId = dataset.entities.parties.find(p => p.roles?.includes("customer"))?.id;

      console.log(`[seed-demo-tenant] Creating registration: ${email2}...`);
      const reg2 = await createPublicRegistration({ eventId, email: email2, displayName: displayName2, partyId: customerPartyId });
      const regId2 = reg2.id;
      const publicToken2 = reg2.publicToken;

      // Checkout
      const checkout2 = await checkoutRegistration({ registrationId: regId2, publicToken: publicToken2 });

      // Simulate payment success via webhook
      if (checkout2.paymentIntentId) {
        await simulatePaymentSuccess({
          paymentIntentId: checkout2.paymentIntentId,
          registrationId: regId2,
          eventId,
        });
      }

      // Poll until confirmed
      const pollResult2 = await pollRegistrationConfirmed(regId2);
      if (!pollResult2.ok) {
        throw new Error(`Registration ${regId2} failed to confirm after checkout`);
      }

      // Check-in BEFORE issuing ticket
      const idempotencyKey2Checkin = `seed-${seed}-reg2-checkin`;
      const checkinResult2 = await checkinRegistration({ registrationId: regId2, idempotencyKey: idempotencyKey2Checkin });
      
      if (!checkinResult2.ok) {
        console.warn(`[seed-demo-tenant] Check-in for ${regId2} failed; skipping ticket issuance`);
        throw new Error(`Check-in failed for ${regId2}: ${JSON.stringify(checkinResult2)}`);
      }

      // Issue ticket AFTER successful check-in
      const idempotencyKey2Ticket = `seed-${seed}-reg2-ticket`;
      const ticket2 = await issueTicket({ registrationId: regId2, idempotencyKey: idempotencyKey2Ticket });
      const ticketId2 = ticket2.ticketId;
      const qrText2 = ticket2.qrText;

      // Print ticket info for manual testing
      console.log(`[seed-demo-tenant] REG2 TICKET ID: ${ticketId2}`);
      console.log(`[seed-demo-tenant] REG2 TICKET QR: ${qrText2}`);

      // NOTE: Skip use for reg2 (intentionally not used)

      dataset.entities.registrations.push({
        email: email2,
        displayName: displayName2,
        registrationId: regId2,
        eventId: eventId,
        status: "confirmed",
        paymentStatus: "paid",
      });

      dataset.entities.tickets.push({
        ticketId: ticketId2,
        registrationId: regId2,
        qrText: qrText2,
        status: "issued",
      });

      console.log(`[seed-demo-tenant] ✓ Reg2: ${regId2}, Ticket: ${ticketId2} (not used)`);
    }

    dataset.summary.registrations = dataset.entities.registrations.length;
    dataset.summary.tickets = dataset.entities.tickets.length;
  } catch (error) {
    console.error(`[seed-demo-tenant] Failed to create registrations/tickets: ${error.message}`);
    process.exit(1);
  }

  // Output
  const output = JSON.stringify(dataset, null, 2);
  if (argv.output) {
    try {
      fs.writeFileSync(argv.output, output, "utf8");
      console.log(`[seed-demo-tenant] Summary written to ${argv.output}`);
    } catch (error) {
      console.error(`[seed-demo-tenant] Failed to write output file: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.log(output);
  }

  console.log(
    JSON.stringify({
      action: "seed-demo-tenant-complete",
      tenant,
      seed,
      success: true,
      timestamp: new Date().toISOString(),
    })
  );
}

main().catch((error) => {
  console.error(`[seed-demo-tenant] Fatal error: ${error.message}`);
  if (error.cause) {
    console.error(`[seed-demo-tenant] Cause: ${error.cause.message}`);
  }
  process.exit(1);
});
