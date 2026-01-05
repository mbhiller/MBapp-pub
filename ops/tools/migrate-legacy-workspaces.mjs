#!/usr/bin/env node
// Tool to migrate legacy workspace-shaped records (type="view") to canonical type="workspace" records.
// Safe by default: requires --confirm + --confirm-tenant (exact match) to migrate; otherwise dry-run only.
// Allowed tenants: SmokeTenant, DemoTenant (use --allow-any-tenant to override).
//
// Usage (dry-run, list candidates only):
//   node ops/tools/migrate-legacy-workspaces.mjs --tenant SmokeTenant
// Usage (migrate with confirmation match):
//   node ops/tools/migrate-legacy-workspaces.mjs --tenant SmokeTenant --confirm --confirm-tenant SmokeTenant
// Usage (force arbitrary tenant):
//   node ops/tools/migrate-legacy-workspaces.mjs --tenant CustomTenant --confirm --confirm-tenant CustomTenant --allow-any-tenant

import process from "process";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { QueryCommand, PutCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

function parseArgs(argv) {
  const opts = {
    tenant: null,
    dryRun: true,
    confirm: false,
    confirmTenant: null,
    allowAnyTenant: false,
    progressEvery: 10,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--confirm") opts.confirm = true;
    else if (arg === "--allow-any-tenant") opts.allowAnyTenant = true;
    else if (arg === "--tenant" && i + 1 < argv.length) opts.tenant = argv[++i];
    else if (arg.startsWith("--tenant=")) opts.tenant = arg.split("=")[1];
    else if (arg === "--confirm-tenant" && i + 1 < argv.length) opts.confirmTenant = argv[++i];
    else if (arg.startsWith("--confirm-tenant=")) opts.confirmTenant = arg.split("=")[1];
    else if (arg === "--progress" && i + 1 < argv.length) opts.progressEvery = Number(argv[++i]) || opts.progressEvery;
    else if (arg.startsWith("--progress=")) opts.progressEvery = Number(arg.split("=")[1]) || opts.progressEvery;
  }
  // --confirm sets dryRun to false
  if (opts.confirm) opts.dryRun = false;
  return opts;
}

const argv = parseArgs(process.argv.slice(2));
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const TABLE = process.env.OBJECTS_TABLE || `${process.env.PROJECT_NAME ?? "mbapp"}_objects`;
const PK = process.env.MBAPP_TABLE_PK || "pk";
const SK = process.env.MBAPP_TABLE_SK || "sk";
const TENANT = (argv.tenant || process.env.MBAPP_TENANT_ID || process.env.MBAPP_SMOKE_TENANT_ID || "SmokeTenant").trim();
const PROGRESS_EVERY = argv.progressEvery;
const ALLOWED_TENANTS = new Set(["SmokeTenant", "DemoTenant"]);

if (!TENANT) {
  console.error("[migrate-legacy-workspaces] Missing tenant (--tenant or MBAPP_TENANT_ID/MBAPP_SMOKE_TENANT_ID)");
  process.exit(1);
}

// Validate tenant against allowlist
if (!argv.allowAnyTenant && !ALLOWED_TENANTS.has(TENANT)) {
  console.error(
    `[migrate-legacy-workspaces] ERROR: tenant '${TENANT}' is not in allowlist [${Array.from(ALLOWED_TENANTS).join(", ")}]`
  );
  console.error("[migrate-legacy-workspaces]        Use --allow-any-tenant to bypass (NOT RECOMMENDED for production)");
  process.exit(2);
}

// Validate confirm-tenant match when --confirm is set
if (argv.confirm) {
  if (!argv.confirmTenant) {
    console.error(
      `[migrate-legacy-workspaces] ERROR: --confirm requires --confirm-tenant <TENANT> for explicit migration confirmation`
    );
    console.error(`[migrate-legacy-workspaces]        Use: --confirm --confirm-tenant ${TENANT}`);
    process.exit(2);
  }
  if (argv.confirmTenant.trim() !== TENANT) {
    console.error(
      `[migrate-legacy-workspaces] ERROR: --confirm-tenant '${argv.confirmTenant}' does not match target tenant '${TENANT}'`
    );
    process.exit(2);
  }
  if (argv.allowAnyTenant) {
    console.warn(`[migrate-legacy-workspaces] WARNING: --allow-any-tenant enabled. Migrating '${TENANT}' (not in allowlist).`);
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

/**
 * Detect if a record is workspace-shaped.
 * Heuristic: Array.isArray(views) AND type==="view" AND NOT a legacy view-only record
 * (i.e., has name field and doesn't have view-specific filters).
 */
function isWorkspaceShaped(item) {
  if (!item) return false;
  if (item.type !== "view") return false;
  if (!Array.isArray(item.views)) return false;
  // Must have a name field (workspaces require name)
  if (typeof item.name !== "string") return false;
  // Exclude if it has filters array (pure view records have filters)
  if (Array.isArray(item.filters)) return false;
  // This is workspace-shaped
  return true;
}

/**
 * List all legacy workspace-shaped records for a tenant.
 * Uses SK prefix query to find type="view" records only (avoid full table scans).
 */
async function listLegacyWorkspaces(tenantId) {
  const items = [];
  let cursor = undefined;
  try {
    do {
      const res = await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
          ExpressionAttributeNames: { "#pk": PK, "#sk": SK },
          ExpressionAttributeValues: {
            ":pk": tenantId,
            ":skPrefix": "view#",
          },
          ExclusiveStartKey: cursor,
        })
      );
      const filtered = (res.Items || []).filter(isWorkspaceShaped);
      items.push(...filtered);
      cursor = res.LastEvaluatedKey;
    } while (cursor);
  } catch (err) {
    console.error(`[migrate-legacy-workspaces] ERROR: Failed to list items for tenant '${tenantId}': ${err.message}`);
    throw err;
  }
  return items;
}

/**
 * Create a canonical workspace record from a legacy record.
 * COPY-ONLY phase: never deletes or updates the legacy record.
 * Preserves: id, name, views, shared, ownerId, defaultViewId, entityType, description, timestamps.
 *
 * Uses conditional put to prevent accidental overwrites:
 * Only succeeds if the target workspace record does not already exist.
 */
async function createWorkspaceFromLegacy(tenantId, legacyRecord) {
  const id = legacyRecord.id;
  if (!id) {
    throw new Error("Legacy record has no id");
  }

  // Build workspace record with same fields
  const workspaceRecord = {
    ...legacyRecord,
    type: "workspace",
  };

  // Clear view-specific fields that should not be in workspace
  delete workspaceRecord.filters;

  // SK for workspace type
  const sk = `workspace#${id}`;

  // ASSERTION: never target a view SK (safety check against logic errors)
  if (sk.startsWith("view#")) {
    throw new Error(`FATAL: Target SK is view-type (${sk}). This is copy-only migration; never write to view SKs.`);
  }

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          [PK]: tenantId,
          [SK]: sk,
          ...workspaceRecord,
        },
        // Conditional: only succeed if the workspace record does not already exist
        ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
        ExpressionAttributeNames: { "#pk": PK, "#sk": SK },
      })
    );
    return { success: true, id, created: true };
  } catch (err) {
    // Check if the error is due to condition failure (already exists)
    if (err.name === "ConditionalCheckFailedException") {
      console.log(`[migrate-legacy-workspaces] workspace record already exists for ${id}, skipping`);
      return { success: true, id, created: false, reason: "workspace_exists" };
    }
    console.error(`[migrate-legacy-workspaces] ERROR: Failed to create workspace ${id}: ${err.message}`);
    throw err;
  }
}

(async function main() {
  const startTime = Date.now();
  console.log(
    `[migrate-legacy-workspaces] table=${TABLE} tenant=${TENANT} dryRun=${argv.dryRun} confirm=${argv.confirm}`
  );

  let candidates;
  try {
    candidates = await listLegacyWorkspaces(TENANT);
  } catch (err) {
    console.error("[migrate-legacy-workspaces] ERROR: Failed to list candidates");
    process.exit(1);
  }

  const candidatesFound = candidates.length;
  console.log(`[migrate-legacy-workspaces] found ${candidatesFound} workspace-shaped type="view" records`);

  // In dry-run mode, show what would happen without actually attempting migrations
  if (!argv.confirm) {
    console.log("[migrate-legacy-workspaces] Dry run: planning to attempt migrations (no actual writes)");
    const sampleSize = Math.min(5, candidatesFound);
    if (sampleSize > 0) {
      const sample = candidates.slice(0, sampleSize);
      console.log(
        `[migrate-legacy-workspaces] Sample of ${sampleSize} candidates to migrate: ${sample.map((c) => c.id).join(", ")}`
      );
    }
    const summary = {
      tenant: TENANT,
      dryRun: true,
      candidatesFound,
      plannedCreates: candidatesFound,
      created: 0,
      skippedExists: 0,
      errors: 0,
    };
    console.log("[migrate-legacy-workspaces] " + JSON.stringify(summary));
    return;
  }

  // Actual migration: attempt to create workspace record for each candidate
  let created = 0;
  let skippedExists = 0;
  const errors = [];
  const createdIds = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const id = candidate.id;

    if (!id) {
      console.warn(`[migrate-legacy-workspaces] WARN: Candidate has no id, skipping`);
      errors.push({ id: "unknown", reason: "no_id" });
      continue;
    }

    try {
      const result = await createWorkspaceFromLegacy(TENANT, candidate);
      if (result.created) {
        created++;
        createdIds.push(id);
      } else {
        skippedExists++;
      }

      if (PROGRESS_EVERY > 0 && (created + skippedExists) % PROGRESS_EVERY === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const processed = created + skippedExists;
        const rate = (processed / elapsed).toFixed(1);
        console.log(
          `[migrate-legacy-workspaces] processed ${processed}/${candidatesFound}... (${rate} items/sec, ${elapsed.toFixed(1)}s)`
        );
      }
    } catch (err) {
      skippedExists++; // Conditional failures are treated as "already exists"
      if (err.name !== "ConditionalCheckFailedException") {
        errors.push({ id, reason: err.message });
        console.error(`[migrate-legacy-workspaces] ERROR: Failed to migrate ${id}: ${err.message}`);
      }
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  const rate = candidatesFound > 0 ? ((created + skippedExists) / elapsed).toFixed(1) : "0";

  // Summary with improved field names
  const summary = {
    tenant: TENANT,
    dryRun: false,
    candidatesFound,
    plannedCreates: candidatesFound,
    created,
    skippedExists,
    errors: errors.length,
    duration_seconds: elapsed.toFixed(2),
    rate_per_sec: rate,
  };

  console.log("[migrate-legacy-workspaces] " + JSON.stringify(summary));

  if (createdIds.length > 0) {
    const sampleSize = Math.min(5, createdIds.length);
    console.log(
      `[migrate-legacy-workspaces] Created ${createdIds.length} workspaces. Sample: ${createdIds.slice(0, sampleSize).join(", ")}`
    );
  }

  if (errors.length > 0) {
    const sampleErrors = errors.slice(0, 5);
    console.error(
      `[migrate-legacy-workspaces] WARNING: ${errors.length} errors (${sampleErrors.length} shown): ${sampleErrors.map((e) => `${e.id}(${e.reason})`).join(", ")}`
    );
    process.exit(1);
  }
})();
