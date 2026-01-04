#!/usr/bin/env node
// Dev-only utility: wipe all objects for a tenant partition in the objects table.
// Safe by default: requires --confirm to delete; otherwise prints how many items would be removed.
// Usage:
//   node ops/tools/wipe-tenant.mjs --tenant SmokeTenant
//   node ops/tools/wipe-tenant.mjs --tenant SmokeTenant --confirm

import process from "process";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, QueryCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

function parseArgs(argv) {
  const opts = { tenant: null, confirm: false, progressEvery: 25 };
  for (const arg of argv) {
    if (arg === "--confirm") opts.confirm = true;
    else if (arg.startsWith("--tenant=")) opts.tenant = arg.split("=")[1];
    else if (arg.startsWith("--progress=")) opts.progressEvery = Number(arg.split("=")[1]) || opts.progressEvery;
  }
  return opts;
}

const argv = parseArgs(process.argv.slice(2));
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const tableObjects = process.env.OBJECTS_TABLE || `${process.env.PROJECT_NAME ?? "mbapp"}_objects`;
const PK = process.env.MBAPP_TABLE_PK || "pk";
const SK = process.env.MBAPP_TABLE_SK || "sk";
const TENANT = argv.tenant || process.env.MBAPP_TENANT_ID || process.env.MBAPP_SMOKE_TENANT_ID || "SmokeTenant";
const PROGRESS_EVERY = argv.progressEvery;

if (!TENANT) {
  console.error("[wipe-tenant] Missing tenant (--tenant or MBAPP_TENANT_ID/MBAPP_SMOKE_TENANT_ID)");
  process.exit(1);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION, endpoint: process.env.DDB_ENDPOINT }), {
  marshallOptions: { convertClassInstanceToMap: true, removeUndefinedValues: true, convertEmptyValues: false },
  unmarshallOptions: { wrapNumbers: false },
});

async function listKeysForTenant(tenantId) {
  const keys = [];
  let cursor = undefined;
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
  return keys;
}

async function deleteKeys(keys) {
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25);
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableObjects]: chunk.map((k) => ({ DeleteRequest: { Key: { [PK]: k[PK], [SK]: k[SK] } } })),
        },
      })
    );
    deleted += chunk.length;
    if (PROGRESS_EVERY > 0 && deleted % PROGRESS_EVERY === 0) {
      console.log(`[wipe-tenant] deleted ${deleted}/${keys.length}...`);
    }
  }
  return deleted;
}

(async function main() {
  console.log(`[wipe-tenant] table=${tableObjects} tenant=${TENANT} confirm=${argv.confirm}`);
  const keys = await listKeysForTenant(TENANT);
  console.log(`[wipe-tenant] found ${keys.length} items for tenant ${TENANT}`);

  if (!argv.confirm) {
    console.log("[wipe-tenant] Dry run complete (no deletes performed). Re-run with --confirm to delete.");
    return;
  }

  if (keys.length === 0) {
    console.log("[wipe-tenant] Nothing to delete.");
    return;
  }

  const deleted = await deleteKeys(keys);
  console.log(`[wipe-tenant] done. deleted=${deleted}`);
})();
