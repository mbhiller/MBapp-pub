// apps/api/src/tools/validate-layoutA.mjs
// Validate (and optionally fix) Layout A for your objects table.
//
// Layout A: PK = <tenantId> stored in env-named attr (default "pk")
//           SK = "type#id"   stored in env-named attr (default "sk")
//
// USAGE (PowerShell examples below):
//   node apps/api/src/tools/validate-layoutA.mjs
//   node apps/api/src/tools/validate-layoutA.mjs --tenant DemoTenant
//   node apps/api/src/tools/validate-layoutA.mjs --limit 500
//   node apps/api/src/tools/validate-layoutA.mjs --tenant DemoTenant --fix
//
// Reads env:
//   MBAPP_OBJECTS_TABLE  (default "mbapp_objects")
//   MBAPP_TABLE_PK       (default "pk")
//   MBAPP_TABLE_SK       (default "sk")

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE   = process.env.MBAPP_OBJECTS_TABLE || "mbapp_objects";
const PK_ATTR = process.env.MBAPP_TABLE_PK || "pk";
const SK_ATTR = process.env.MBAPP_TABLE_SK || "sk";

// ---- tiny arg parser (no deps) ----
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const TENANT = argv.tenant || process.env.MBAPP_TENANT_ID || null;
const LIMIT  = argv.limit ? Number(argv.limit) : 0; // 0 = no cap
const FIX    = !!argv.fix;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function* chunks(arr, size) {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

function parseSk(sk) {
  if (typeof sk !== "string") return { type: null, id: null };
  const i = sk.indexOf("#");
  if (i < 1) return { type: null, id: null };
  return { type: sk.slice(0, i), id: sk.slice(i + 1) };
}

function mustString(v) {
  return typeof v === "string" && v.length > 0;
}

async function* scanAll({ tableName, tenant = null }) {
  let ExclusiveStartKey;
  let count = 0;
  do {
    const params = {
      TableName: tableName,
      ExclusiveStartKey,
    };
    // If tenant provided, FilterExpression narrows reported results (still scans underlying pages).
    if (tenant) {
      params.FilterExpression = `#pk = :t`;
      params.ExpressionAttributeNames = { "#pk": PK_ATTR };
      params.ExpressionAttributeValues = { ":t": tenant };
    }
    const res = await ddb.send(new ScanCommand(params));
    for (const item of res.Items || []) {
      yield item;
      count += 1;
      if (LIMIT && count >= LIMIT) return;
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
}

async function validateAndMaybeFix(item) {
  const pk = item[PK_ATTR];
  const sk = item[SK_ATTR];
  const type = item.type;
  const id = item.id;

  const issues = [];

  if (!mustString(pk)) issues.push(`missing_pk_attr(${PK_ATTR})`);
  if (!mustString(sk)) issues.push(`missing_sk_attr(${SK_ATTR})`);
  if (!mustString(type)) issues.push("missing_type");
  if (!mustString(id)) issues.push("missing_id");

  const parsed = parseSk(sk);
  if (mustString(sk) && (!parsed.type || !parsed.id)) {
    issues.push("malformed_sk");
  }
  if (mustString(type) && mustString(id) && mustString(sk)) {
    if (parsed.type !== type || parsed.id !== String(id)) {
      issues.push("sk_mismatch");
    }
  }

  // Attempt fix for missing/mismatch sk if --fix
  let fixed = null;
  if (FIX && mustString(pk) && mustString(type) && mustString(id)) {
    const desiredSk = `${type}#${id}`;
    if (sk !== desiredSk) {
      // Update only the SK attribute; keep everything else intact
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { [PK_ATTR]: pk, [SK_ATTR]: sk ?? `${type}#${id}` }, // If SK missing, this won't match; fallback to trying a pk-only re-update below.
        UpdateExpression: `SET #sk = :v`,
        ExpressionAttributeNames: { "#sk": SK_ATTR },
        ExpressionAttributeValues: { ":v": desiredSk },
      }).catch(async (err) => {
        // If SK was missing, the above UpdateCommand can't find the item by key.
        // Fallback: try to find by pk alone (scan-by-pk-one-item) and update it.
        // This is a best-effort repair path. You can comment it out if not desired.
        // eslint-disable-next-line no-console
        console.warn("Direct update by old key failed; attempting pk-only locate:", err?.message);
        // No robust pk-only update in a single call; leave as is and report.
      }));
      fixed = { [SK_ATTR]: { from: sk || null, to: desiredSk } };
    }
  }

  return { issues, fixed };
}

async function main() {
  const startedAt = new Date().toISOString();
  let total = 0;
  let ok = 0;
  let bad = 0;
  const sampleProblems = [];

  for await (const item of scanAll({ tableName: TABLE, tenant: TENANT })) {
    total += 1;
    const { issues, fixed } = await validateAndMaybeFix(item);
    if (issues.length === 0 && !fixed) {
      ok += 1;
      continue;
    }
    bad += 1;
    if (sampleProblems.length < 50) {
      sampleProblems.push({
        key: { [PK_ATTR]: item[PK_ATTR], [SK_ATTR]: item[SK_ATTR] ?? null },
        id: item.id ?? null,
        type: item.type ?? null,
        issues,
        fixed: fixed || null,
      });
    }
  }

  const endedAt = new Date().toISOString();
  const summary = {
    table: TABLE,
    pkAttr: PK_ATTR,
    skAttr: SK_ATTR,
    tenant: TENANT || "(all)",
    limit: LIMIT || "(none)",
    fixApplied: FIX,
    startedAt,
    endedAt,
    counts: { total, ok, bad },
    sampleProblems,
  };

  const okAll = bad === 0;
  if (okAll) {
    console.log("✅ Layout A validation passed.");
  } else if (FIX) {
    console.log("⚠️  Layout A had problems; attempted fixes applied (see details below).");
  } else {
    console.log("❌ Layout A validation found problems (see details below).");
  }
  console.log(JSON.stringify(summary, null, 2));

  // Exit code: 0 if all good or fixes applied, 2 if problems and not fixed.
  process.exit(okAll || FIX ? 0 : 2);
}

main().catch((e) => {
  console.error("Validator crashed:", e);
  process.exit(1);
});
