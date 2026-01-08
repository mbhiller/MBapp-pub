#!/usr/bin/env node
/**
 * Backfill registration event index keys (gsi4pk/gsi4sk) for existing registrations.
 * Safe + resumable with cursor output.
 *
 * Dry run example:
 *   node ops/tools/backfill-registration-event-index.mjs --tenant SmokeTenant --dry-run --limit 25
 */

import process from "process";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

function parseArgs(argv) {
  const opts = {
    tenant: null,
    confirmTenant: null,
    dryRun: false,
    limit: 500,
    cursor: null,
    maxWritesPerSecond: 5,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--tenant" && i + 1 < argv.length) opts.tenant = argv[++i];
    else if (arg.startsWith("--tenant=")) opts.tenant = arg.split("=")[1];
    else if (arg === "--confirm-tenant" && i + 1 < argv.length) opts.confirmTenant = argv[++i];
    else if (arg.startsWith("--confirm-tenant=")) opts.confirmTenant = arg.split("=")[1];
    else if (arg === "--limit" && i + 1 < argv.length) opts.limit = Number(argv[++i]) || opts.limit;
    else if (arg.startsWith("--limit=")) opts.limit = Number(arg.split("=")[1]) || opts.limit;
    else if (arg === "--cursor" && i + 1 < argv.length) opts.cursor = argv[++i];
    else if (arg.startsWith("--cursor=")) opts.cursor = arg.split("=")[1];
    else if (arg === "--max-writes-per-second" && i + 1 < argv.length) opts.maxWritesPerSecond = Number(argv[++i]) || opts.maxWritesPerSecond;
    else if (arg.startsWith("--max-writes-per-second=")) opts.maxWritesPerSecond = Number(arg.split("=")[1]) || opts.maxWritesPerSecond;
  }

  if (opts.limit <= 0) opts.limit = 1;
  if (opts.maxWritesPerSecond <= 0) opts.maxWritesPerSecond = 1;

  return opts;
}

function encodeCursor(key) {
  if (!key) return null;
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64");
}

function decodeCursor(token) {
  if (!token) return undefined;
  try {
    return JSON.parse(Buffer.from(token, "base64").toString("utf8"));
  } catch (err) {
    console.error("[backfill-registration-event-index] WARN: failed to decode cursor", err?.message || err);
    return undefined;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function computeIndexKeys({ tenantId, reg }) {
  const eventId = reg?.eventId;
  const id = reg?.id;
  if (!tenantId || !eventId || !id) return null;

  const dateComponent = reg?.submittedAt || reg?.createdAt || reg?.updatedAt || nowIso();
  return {
    gsi4pk: `${tenantId}|event|${eventId}`,
    gsi4sk: `${dateComponent}#${id}`,
  };
}

async function sleep(ms) {
  if (ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const argv = parseArgs(process.argv.slice(2));
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const TABLE = process.env.MBAPP_OBJECTS_TABLE || process.env.MBAPP_TABLE || `${process.env.PROJECT_NAME ?? "mbapp"}_objects`;
const PK = process.env.MBAPP_TABLE_PK || "pk";
const SK = process.env.MBAPP_TABLE_SK || "sk";
const ALLOWED_TENANTS = new Set(["SmokeTenant", "ExampleTenant"]);

if (!argv.tenant) {
  console.error("[backfill-registration-event-index] ERROR: --tenant is required");
  process.exit(1);
}

if (!argv.dryRun) {
  if (!argv.confirmTenant) {
    console.error("[backfill-registration-event-index] ERROR: --confirm-tenant <TENANT> is required when not using --dry-run");
    process.exit(1);
  }
  if (argv.confirmTenant !== argv.tenant) {
    console.error(`[backfill-registration-event-index] ERROR: --confirm-tenant '${argv.confirmTenant}' does not match target tenant '${argv.tenant}'`);
    process.exit(1);
  }
  if (!ALLOWED_TENANTS.has(argv.tenant)) {
    console.error(`[backfill-registration-event-index] ERROR: tenant '${argv.tenant}' not in allowlist [${Array.from(ALLOWED_TENANTS).join(", ")}]`);
    process.exit(1);
  }
} else {
  if (!ALLOWED_TENANTS.has(argv.tenant)) {
    console.warn(`[backfill-registration-event-index] WARN: tenant '${argv.tenant}' not in allowlist; allowed tenants are [${Array.from(ALLOWED_TENANTS).join(", ")}]`);
  }
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION, endpoint: process.env.DDB_ENDPOINT }), {
  marshallOptions: { convertClassInstanceToMap: true, removeUndefinedValues: true, convertEmptyValues: false },
  unmarshallOptions: { wrapNumbers: false },
});

async function main() {
  const minWriteIntervalMs = 1000 / argv.maxWritesPerSecond;
  let lastWriteTs = 0;
  let examined = 0;
  let updated = 0;
  let wouldUpdate = 0;
  let skippedIndexed = 0;
  let skippedMissing = 0;
  let errors = 0;
  let sample = [];
  let cursor = decodeCursor(argv.cursor);
  let resumeCursor = null;
  const started = Date.now();

  console.log(`[backfill-registration-event-index] table=${TABLE} tenant=${argv.tenant} dryRun=${argv.dryRun} limit=${argv.limit} cursor=${argv.cursor ? "yes" : "no"} maxWPS=${argv.maxWritesPerSecond}`);

  outer: while (true) {
    const page = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skprefix)",
      ExpressionAttributeNames: { "#pk": PK, "#sk": SK },
      ExpressionAttributeValues: { ":pk": argv.tenant, ":skprefix": "registration#" },
      ExclusiveStartKey: cursor,
      Limit: Math.min(200, argv.limit - examined),
      ProjectionExpression: "#pk, #sk, id, type, eventId, submittedAt, createdAt, updatedAt, gsi4pk, gsi4sk",
      ConsistentRead: true,
    }));

    const items = page.Items || [];

    for (const item of items) {
      if (examined >= argv.limit) {
        resumeCursor = encodeCursor({ [PK]: item[PK], [SK]: item[SK] });
        break outer;
      }

      examined += 1;
      const keys = computeIndexKeys({ tenantId: argv.tenant, reg: item });
      if (!keys) {
        skippedMissing += 1;
        continue;
      }

      const alreadyIndexed = item.gsi4pk === keys.gsi4pk && item.gsi4sk === keys.gsi4sk;
      if (alreadyIndexed) {
        skippedIndexed += 1;
        continue;
      }

      if (argv.dryRun) {
        wouldUpdate += 1;
        if (sample.length < 5) {
          sample.push({ id: item.id, eventId: item.eventId, from: { gsi4pk: item.gsi4pk, gsi4sk: item.gsi4sk }, to: keys });
        }
        continue;
      }

      if (minWriteIntervalMs > 0) {
        const elapsed = Date.now() - lastWriteTs;
        if (elapsed < minWriteIntervalMs) {
          await sleep(minWriteIntervalMs - elapsed);
        }
      }

      try {
        await ddb.send(new UpdateCommand({
          TableName: TABLE,
          Key: { [PK]: argv.tenant, [SK]: item[SK] },
          UpdateExpression: "SET #gpk = :gpk, #gsk = :gsk",
          ConditionExpression: "begins_with(#sk, :skprefix)",
          ExpressionAttributeNames: { "#gpk": "gsi4pk", "#gsk": "gsi4sk", "#sk": SK },
          ExpressionAttributeValues: { ":gpk": keys.gsi4pk, ":gsk": keys.gsi4sk, ":skprefix": "registration#" },
        }));
        updated += 1;
        lastWriteTs = Date.now();
      } catch (err) {
        errors += 1;
        console.error(`[backfill-registration-event-index] ERROR updating id=${item.id} eventId=${item.eventId}: ${err.message}`);
      }
    }

    if (examined >= argv.limit) {
      resumeCursor = resumeCursor || encodeCursor(page.LastEvaluatedKey);
      break;
    }

    if (!page.LastEvaluatedKey) {
      break;
    }

    cursor = page.LastEvaluatedKey;
  }

  const durationMs = Date.now() - started;
  const resumeToken = resumeCursor || encodeCursor(cursor);
  const summary = {
    tenant: argv.tenant,
    dryRun: argv.dryRun,
    examined,
    updated,
    wouldUpdate: argv.dryRun ? wouldUpdate : undefined,
    skippedIndexed,
    skippedMissing,
    errors,
    durationMs,
    resumeCursor: resumeToken,
    sample: argv.dryRun ? sample : undefined,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (resumeToken) {
    console.log(`[backfill-registration-event-index] Resume with --cursor ${resumeToken}`);
  }

  if (errors > 0 && !argv.dryRun) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[backfill-registration-event-index] fatal", err);
  process.exit(1);
});
