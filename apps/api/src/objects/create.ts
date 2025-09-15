import { PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, error as errResp, conflict } from "../common/responses";
import { getTenantId } from "../common/env";

const uniqPk = (tenant: string, skuLc: string) => `UNIQ#${tenant}#product#SKU#${skuLc}`;

function parseKind(input: unknown): "good" | "service" | undefined {
  if (typeof input !== "string") return undefined;
  const k = input.trim().toLowerCase();
  return k === "good" || k === "service" ? k : undefined;
}

export const handler = async (evt: any) => {
  try {
    const tenantId = getTenantId(evt);
    if (!tenantId) return bad("x-tenant-id header required");

    const typeParam = (evt?.pathParameters?.type as string | undefined)?.trim();
    if (!typeParam) return bad("type is required");

    const nowIso = new Date().toISOString();

    let body: any = {};
    if (evt?.body) {
      try { body = JSON.parse(evt.body); }
      catch { return bad("invalid JSON body"); }
    }

    const id = (body?.id as string | undefined) || randomUUID();

    // ---- Base item (shared) ----
    const base: any = {
      pk: id,
      sk: `${tenantId}|${typeParam}`,
      id,
      type: typeParam,
      tenantId,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    // ========== PRODUCT ==========
    if (typeParam === "product") {
  const name = String(body?.name ?? "").trim();
  if (!name) return bad("name is required");

  const sku = body?.sku != null ? String(body.sku).trim() : undefined;
  const price = body?.price != null ? Number(body.price) : undefined;
  const uom = body?.uom != null ? String(body.uom) : undefined;
  const taxCode = body?.taxCode != null ? String(body.taxCode) : undefined;
  const kind = parseKind(body?.kind) ?? "good";

  const item: any = {
    ...base,
    name, sku, price, uom, taxCode, kind,
    // ✅ index by createdAt so list can be DESC (newest → oldest)
    gsi1pk: `${tenantId}|product`,
    gsi1sk: `createdAt#${nowIso}#id#${id}`,
  };

  if (sku) {
    const skuLc = sku.toLowerCase();
    item.skuLc = skuLc;

    await ddb.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableObjects,
            Item: {
              pk: uniqPk(tenantId, skuLc),
              sk: id,
              id,
              tenantId,
              type: "product:sku",
              createdAt: nowIso,
            },
            ConditionExpression: "attribute_not_exists(pk)",
          }
        },
        { Put: { TableName: tableObjects, Item: item } },
      ],
    }));
    return ok(item);
  }

  await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
  return ok(item);
}

    // ========== EVENT ==========
    if (typeParam === "event") {
      const name = String(body?.name ?? "").trim();
      if (!name) return bad("name is required");

      const item: any = {
        ...base,
        name,
        startsAt: body?.startsAt ? String(body.startsAt) : undefined,
        endsAt:   body?.endsAt   ? String(body.endsAt)   : undefined,
        status:   body?.status   ? String(body.status)   : undefined,
        // match list-by-type pattern (no special index required)
        gsi1pk: `${tenantId}|event`,
        gsi1sk: `createdAt#${nowIso}#id#${id}`,
      };

      await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
      return ok(item);
    }

    // ======== REGISTRATION ========
    if (typeParam === "registration") {
      const eventId = String(body?.eventId ?? "").trim();
      if (!eventId) return bad("eventId is required");

      const item: any = {
        ...base,
        eventId,
        accountId: body?.accountId ? String(body.accountId) : undefined,
        status: body?.status ? String(body.status) : "pending",
        gsi1pk: `${tenantId}|registration`,
        gsi1sk: `createdAt#${nowIso}#id#${id}`,
      };

      await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
      return ok(item);
    }

    // ======== DEFAULT (other types) ========
    const item: any = { ...base, ...(body || {}) };
    item.gsi1pk = `${tenantId}|${typeParam}`;
    item.gsi1sk = `createdAt#${nowIso}#id#${id}`;

    await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
    return ok(item);
  } catch (e: any) {
    if ((e?.name || "").includes("ConditionalCheckFailed")) {
      return conflict("SKU already exists for this tenant");
    }
    return errResp(e);
  }
};
