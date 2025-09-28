// apps/api/src/tools/fix-layoutA.mjs
// Normalize all items to Layout A:
//   pk = id
//   sk = "<tenantId>|<type>|<id>"
// Handles UNIQ lock rows (pk: "UNIQ#..."), type normalization, and rekeying.
// Usage:
//   node apps/api/src/tools/fix-layoutA.mjs           # dry run
//   node apps/api/src/tools/fix-layoutA.mjs --apply   # apply fixes
//
// Env:
//   TABLE=mbapp_objects (default)
//   MBAPP_TENANT_ID=DemoTenant (optional: limit by tenant)
//   AWS_REGION / AWS_PROFILE as you already set in your PowerShell profile

import {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
  DeleteItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const TABLE = process.env.TABLE || "mbapp_objects";
const TENANT_FILTER = (process.env.MBAPP_TENANT_ID || "").trim();
const APPLY = process.argv.includes("--apply");

const client = new DynamoDBClient({});

// legacy -> canonical
const TYPE_NORMALIZE = {
  inventoryItem: "inventory",
  product: "product",
  account: "account",
  client: "client",
  vendor: "vendor",
  event: "event",
  registration: "registration",
  employee: "employee",
  view: "view",
  workspace: "workspace",
  horse: "horse",
};

function safeType(t) {
  return t ? TYPE_NORMALIZE[t] || t : t;
}

function parseUniqPk(pk) {
  const m = /^UNIQ#([^#]+)#([^#]+)#([^#]+)#(.+)$/.exec(pk || "");
  if (!m) return null;
  const [, tenant, baseType, field, value] = m;
  return { tenant, baseType: safeType(baseType), field, value };
}

function inferFromSk(sk) {
  if (!sk || typeof sk !== "string") return {};
  const [tenantId, typeMaybe, idMaybe] = sk.split("|");
  return { tenantId, type: safeType(typeMaybe), idFromSk: idMaybe };
}

function wantSk({ tenantId, type, id }) {
  return `${tenantId}|${type}|${id}`;
}

function needsFix(entity) {
  const issues = [];

  const uniq = parseUniqPk(entity.pk);
  if (uniq) {
    const id = (entity.sk && /^[0-9a-f-]{8}-/.test(entity.sk)) ? entity.sk : entity.id;
    if (!id) issues.push("uniq_missing_id");

    const expectedSk = id ? `${uniq.tenant}|${uniq.baseType}|${id}` : null;
    if (!expectedSk || entity.sk !== expectedSk) issues.push("uniq_malformed_sk");

    const wantType = `${uniq.baseType}:${uniq.field.toLowerCase()}`;
    if (entity.type !== wantType) issues.push("uniq_type_mismatch");

    if (entity.tenantId !== uniq.tenant) issues.push("uniq_missing_tenantId");
    return issues;
  }

  // regular entity
  const { tenantId: tSk, type: tySk, idFromSk } = inferFromSk(entity.sk);
  const tenantId = entity.tenantId || tSk;
  if (!tenantId) issues.push("missing_tenantId");

  const type = safeType(entity.type || tySk);
  if (!type) issues.push("missing_type");

  const id = entity.id || entity.pk;
  if (!id) issues.push("missing_id");

  if (id && entity.pk !== id) issues.push("pk_mismatch");

  if (tenantId && type && id) {
    const expectedSk = wantSk({ tenantId, type, id });
    if (entity.sk !== expectedSk) issues.push("sk_mismatch");
    const short = `${tenantId}|${type}`;
    if (entity.sk === short) issues.push("malformed_sk");
  }

  if (entity.type !== type) issues.push("type_normalize");
  return issues;
}

function buildFix(entity) {
  const now = new Date().toISOString();
  const uniq = parseUniqPk(entity.pk);

  if (uniq) {
    const id =
      (entity.sk && /^[0-9a-f-]{8}-/.test(entity.sk) && entity.sk) ||
      entity.id ||
      null;
    const type = `${uniq.baseType}:${uniq.field.toLowerCase()}`;
    const tenantId = uniq.tenant;

    const patched = {
      ...entity,
      type,
      tenantId,
      uniqueField: entity.uniqueField || uniq.field,
      uniqueValue: entity.uniqueValue || uniq.value,
      updatedAt: now,
    };
    if (id) patched.sk = `${tenantId}|${uniq.baseType}|${id}`;

    // keep pk as the UNIQ key (that’s the point of the lock row)
    return {
      newKey: { pk: patched.pk, sk: patched.sk }, // pk unchanged; sk may change
      oldKey: { pk: entity.pk, sk: entity.sk },
      newItem: patched,
    };
  }

  // regular entity
  const { tenantId: tSk, type: tySk } = inferFromSk(entity.sk);
  const tenantId = entity.tenantId || tSk || process.env.MBAPP_TENANT_ID || "DemoTenant";
  const type = safeType(entity.type || tySk || "unknown");
  const id = entity.id || entity.pk;

  const newPk = id; // Layout A
  const newSk = wantSk({ tenantId, type, id });

  const patched = {
    ...entity,
    id,
    pk: newPk,
    sk: newSk,
    tenantId,
    type,
    updatedAt: now,
  };

  return {
    newKey: { pk: newPk, sk: newSk },
    oldKey: { pk: entity.pk, sk: entity.sk },
    newItem: patched,
  };
}

async function scanAll() {
  let items = [];
  let ExclusiveStartKey;
  do {
    const res = await client.send(
      new ScanCommand({
        TableName: TABLE,
        ExclusiveStartKey,
      })
    );
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items.map(unmarshall);
}

function passesTenantFilter(x) {
  if (!TENANT_FILTER) return true;
  const uniq = parseUniqPk(x.pk);
  if (uniq) return uniq.tenant === TENANT_FILTER;
  if (x.tenantId) return x.tenantId === TENANT_FILTER;
  if (typeof x.sk === "string") return x.sk.startsWith(`${TENANT_FILTER}|`);
  return false;
}

async function getRaw(key) {
  const res = await client.send(
    new GetItemCommand({ TableName: TABLE, Key: marshall(key) })
  );
  return res.Item ? unmarshall(res.Item) : null;
}

async function putNew(item) {
  await client.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: marshall(item, { removeUndefinedValues: true }),
      // Don't clobber if something else already wrote this exact key
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
    })
  );
}

async function deleteOld(key) {
  await client.send(
    new DeleteItemCommand({
      TableName: TABLE,
      Key: marshall(key),
    })
  );
}

(async () => {
  const all = (await scanAll()).filter(passesTenantFilter);

  let total = 0;
  let bad = 0;
  let fixed = 0;
  const previews = [];

  for (const entity of all) {
    total++;
    const issues = needsFix(entity);
    if (issues.length === 0) continue;
    bad++;

    const plan = buildFix(entity);

    // If the key doesn't change (pk,sk same), it’s a simple attribute update. But since sk often changes,
    // we rekey uniformly: put new then delete old. If keys equal, Put will fail due to condition; in that case
    // fall back to deleteOld (no-op) — or skip.
    const keyChanged =
      plan.oldKey.pk !== plan.newKey.pk || plan.oldKey.sk !== plan.newKey.sk;

    if (!APPLY) {
      if (previews.length < 25) {
        previews.push({
          oldKey: plan.oldKey,
          newKey: plan.newKey,
          issues,
          sampleAttrs: {
            id: plan.newItem.id,
            type: plan.newItem.type,
            tenantId: plan.newItem.tenantId,
            sk: plan.newItem.sk,
          },
        });
      }
      continue;
    }

    try {
      if (keyChanged) {
        // 1) write new (merge: prefer plan.newItem)
        await putNew(plan.newItem);

        // 2) delete old (best effort)
        if (plan.oldKey.pk !== plan.newKey.pk || plan.oldKey.sk !== plan.newKey.sk) {
          await deleteOld(plan.oldKey);
        }
        fixed++;
      } else {
        // Keys same but attributes changed (rare with this tool). Rewrite in place via putNew after reading current.
        const current = await getRaw(plan.oldKey);
        const merged = { ...current, ...plan.newItem };
        await client.send(
          new PutItemCommand({
            TableName: TABLE,
            Item: marshall(merged, { removeUndefinedValues: true }),
          })
        );
        fixed++;
      }
    } catch (e) {
      // Log and keep going
      console.error("rekey/put/delete error", { oldKey: plan.oldKey, newKey: plan.newKey, msg: e.message });
    }
  }

  const summary = {
    table: TABLE,
    tenant: TENANT_FILTER || "(all)",
    apply: APPLY,
    counts: { total, bad, fixed, ok: total - bad },
    previews,
  };
  console.log(JSON.stringify(summary, null, 2));
})();
