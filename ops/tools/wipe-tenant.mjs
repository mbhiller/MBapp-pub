#!/usr/bin/env node
// Dev-only utility: wipe all objects for a tenant partition in the objects table.
// Safe by default: requires --confirm + --confirm-tenant (exact match) to delete; otherwise prints how many items would be removed.
// Blocks production wipes unless --allow-production is set.
// Allowed tenants: SmokeTenant, DemoTenant (use --allow-any-tenant to override).
// Usage (dry-run, list items only):
//   node ops/tools/wipe-tenant.mjs --tenant SmokeTenant
// Usage (delete with confirmation match):
//   node ops/tools/wipe-tenant.mjs --tenant SmokeTenant --confirm --confirm-tenant SmokeTenant
// Usage (force arbitrary tenant with warning):
//   node ops/tools/wipe-tenant.mjs --tenant CustomTenant --confirm --confirm-tenant CustomTenant --allow-any-tenant
// Usage (production delete with caution):
//   node ops/tools/wipe-tenant.mjs --tenant SmokeTenant --confirm --confirm-tenant SmokeTenant --allow-production

import process from "process";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, QueryCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

function parseArgs(argv) {
  const opts = { tenant: null, confirm: false, confirmTenant: null, allowAnyTenant: false, allowProduction: false, progressEvery: 25 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--confirm") opts.confirm = true;
    else if (arg === "--allow-any-tenant") opts.allowAnyTenant = true;
    else if (arg === "--allow-production") opts.allowProduction = true;
    else if (arg === "--tenant" && i + 1 < argv.length) opts.tenant = argv[++i];
    else if (arg.startsWith("--tenant=")) opts.tenant = arg.split("=")[1];
    else if (arg === "--confirm-tenant" && i + 1 < argv.length) opts.confirmTenant = argv[++i];
    else if (arg.startsWith("--confirm-tenant=")) opts.confirmTenant = arg.split("=")[1];
    else if (arg === "--progress" && i + 1 < argv.length) opts.progressEvery = Number(argv[++i]) || opts.progressEvery;
    else if (arg.startsWith("--progress=")) opts.progressEvery = Number(arg.split("=")[1]) || opts.progressEvery;
  }
  return opts;
}

const argv = parseArgs(process.argv.slice(2));
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const tableObjects = process.env.OBJECTS_TABLE || `${process.env.PROJECT_NAME ?? "mbapp"}_objects`;
const PK = process.env.MBAPP_TABLE_PK || "pk";
const SK = process.env.MBAPP_TABLE_SK || "sk";
const TENANT = (argv.tenant || process.env.MBAPP_TENANT_ID || process.env.MBAPP_SMOKE_TENANT_ID || "SmokeTenant").trim();
const PROGRESS_EVERY = argv.progressEvery;
const ALLOWED_TENANTS = new Set(["SmokeTenant", "DemoTenant"]);

// Detect production mode: NODE_ENV=production or MBAPP_ENV=prod
const NODE_ENV = process.env.NODE_ENV || "development";
const MBAPP_ENV = process.env.MBAPP_ENV || null;
const IS_PRODUCTION = NODE_ENV === "production" || MBAPP_ENV === "prod";

if (!TENANT) {
  console.error("[wipe-tenant] Missing tenant (--tenant or MBAPP_TENANT_ID/MBAPP_SMOKE_TENANT_ID)");
  process.exit(1);
}

// Validate tenant against allowlist
if (!argv.allowAnyTenant && !ALLOWED_TENANTS.has(TENANT)) {
  console.error(`[wipe-tenant] ERROR: tenant '${TENANT}' is not in allowlist [${Array.from(ALLOWED_TENANTS).join(", ")}]`);
  console.error("[wipe-tenant]        Use --allow-any-tenant to bypass (NOT RECOMMENDED for production)");
  process.exit(2);
}

// Validate production mode for deletes
if (argv.confirm && IS_PRODUCTION && !argv.allowProduction) {
  console.error(`[wipe-tenant] ERROR: Cannot delete in production mode (NODE_ENV=${NODE_ENV}${MBAPP_ENV ? `, MBAPP_ENV=${MBAPP_ENV}` : ""})`);
  console.error("[wipe-tenant]        To proceed, use --allow-production flag");
  process.exit(3);
}

// Validate confirm-tenant match when --confirm is set
if (argv.confirm) {
  if (!argv.confirmTenant) {
    console.error(`[wipe-tenant] ERROR: --confirm requires --confirm-tenant <TENANT> for explicit deletion confirmation`);
    console.error(`[wipe-tenant]        Use: --confirm --confirm-tenant ${TENANT}`);
    process.exit(2);
  }
  if (argv.confirmTenant.trim() !== TENANT) {
    console.error(`[wipe-tenant] ERROR: --confirm-tenant '${argv.confirmTenant}' does not match target tenant '${TENANT}'`);
    process.exit(2);
  }
  if (argv.allowAnyTenant) {
    console.warn(`[wipe-tenant] WARNING: --allow-any-tenant enabled. Wiping '${TENANT}' (not in allowlist).`);
  }
  if (IS_PRODUCTION && argv.allowProduction) {
    console.warn(`[wipe-tenant] WARNING: --allow-production enabled. Wiping '${TENANT}' in production mode.`);
  }
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION, endpoint: process.env.DDB_ENDPOINT }), {
  marshallOptions: { convertClassInstanceToMap: true, removeUndefinedValues: true, convertEmptyValues: false },
  unmarshallOptions: { wrapNumbers: false },
});

// Retry constants
const MAX_RETRIES = 8;
const BACKOFF_BASE_MS = 100;
const BACKOFF_MAX_MS = 5000;

function getBackoffMs(attempt) {
  const exponential = BACKOFF_BASE_MS * Math.pow(2, attempt);
  const capped = Math.min(exponential, BACKOFF_MAX_MS);
  const jitter = capped * Math.random();
  return Math.floor(jitter);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listKeysForTenant(tenantId) {
  const keys = [];
  let cursor = undefined;
  try {
    do {
      const res = await ddb.send(
        new QueryCommand({
          TableName: tableObjects,
          KeyConditionExpression: "#pk = :pk",
          ExpressionAttributeNames: { "#pk": PK, "#sk": SK },
          ExpressionAttributeValues: { ":pk": tenantId },
          ProjectionExpression: "#pk, #sk",
          ExclusiveStartKey: cursor,
        })
      );
      keys.push(...(res.Items || []));
      cursor = res.LastEvaluatedKey;
    } while (cursor);
  } catch (err) {
    console.error(`[wipe-tenant] ERROR: Failed to query items for tenant '${tenantId}': ${err.message}`);
    throw err;
  }
  return keys;
}

async function deleteKeys(keys, startTime) {
  let deleted = 0;
  let failed = [];
  
  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25);
    let toDelete = chunk;
    let retryCount = 0;
    
    while (toDelete.length > 0 && retryCount <= MAX_RETRIES) {
      try {
        const res = await ddb.send(
          new BatchWriteCommand({
            RequestItems: {
              [tableObjects]: toDelete.map((k) => ({ DeleteRequest: { Key: { [PK]: k[PK], [SK]: k[SK] } } })),
            },
          })
        );
        
        // Handle unprocessed items
        const unprocessed = res.UnprocessedItems?.[tableObjects] || [];
        if (unprocessed.length > 0) {
          // Extract keys from unprocessed DeleteRequests
          toDelete = unprocessed.map((req) => req.DeleteRequest.Key);
          retryCount++;
          if (retryCount <= MAX_RETRIES) {
            const backoffMs = getBackoffMs(retryCount - 1);
            console.log(`[wipe-tenant] retry ${retryCount}/${MAX_RETRIES} in ${backoffMs}ms (${toDelete.length} items)`);
            await sleep(backoffMs);
          }
        } else {
          // All items processed successfully
          deleted += chunk.length;
          toDelete = [];
        }
      } catch (err) {
        console.error(`[wipe-tenant] ERROR: BatchWrite failed: ${err.message}`);
        failed.push(...toDelete);
        toDelete = [];
      }
    }
    
    // If we exhausted retries, add remaining to failed list
    if (toDelete.length > 0) {
      failed.push(...toDelete);
    }
    
    // Progress logging
    if (PROGRESS_EVERY > 0 && deleted > 0 && deleted % PROGRESS_EVERY === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (deleted / elapsed).toFixed(1);
      console.log(`[wipe-tenant] deleted ${deleted}/${keys.length}... (${rate} items/sec, ${elapsed.toFixed(1)}s)`);
    }
  }
  
  return { deleted, failed };
}

(async function main() {
  const startTime = Date.now();
  console.log(`[wipe-tenant] env=${NODE_ENV} table=${tableObjects} tenant=${TENANT} confirm=${argv.confirm}${IS_PRODUCTION ? " [PRODUCTION]" : ""}`);
  
  let keys;
  try {
    keys = await listKeysForTenant(TENANT);
  } catch (err) {
    process.exit(1);
  }
  
  console.log(`[wipe-tenant] found ${keys.length} items for tenant ${TENANT}`);

  if (!argv.confirm) {
    console.log("[wipe-tenant] Dry run complete (no deletes performed). Re-run with --confirm to delete.");
    return;
  }

  if (keys.length === 0) {
    console.log("[wipe-tenant] Nothing to delete.");
    return;
  }

  let result;
  try {
    result = await deleteKeys(keys, startTime);
  } catch (err) {
    console.error(`[wipe-tenant] ERROR: Deletion failed: ${err.message}`);
    process.exit(1);
  }

  const elapsed = (Date.now() - startTime) / 1000;
  const rate = (result.deleted / elapsed).toFixed(1);
  console.log(`[wipe-tenant] done. found=${keys.length} deleted=${result.deleted} failed=${result.failed.length} duration=${elapsed.toFixed(1)}s (${rate} items/sec)`);
  
  if (result.failed.length > 0) {
    console.error(`[wipe-tenant] WARNING: ${result.failed.length} items failed to delete. Keys: ${result.failed.map((k) => `${k[PK]}#${k[SK]}`).slice(0, 5).join(", ")}${result.failed.length > 5 ? "..." : ""}`);
    process.exit(1);
  }
})();
