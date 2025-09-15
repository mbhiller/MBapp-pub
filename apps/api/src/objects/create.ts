import { GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
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
    if (evt?.body) { try { body = JSON.parse(evt.body); } catch { return bad("invalid JSON body"); } }

    const id = (body?.id as string | undefined) || randomUUID();

    // Base item (shared)
    const item: any = {
      pk: id,
      sk: `${tenantId}|${typeParam}`,
      id,
      type: typeParam,
      tenantId,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    // ——— Product specifics (preserve your existing behavior) ———
    if (typeParam === "product") {
      const name = String(body?.name ?? "").trim();
      const sku = body?.sku != null ? String(body.sku).trim() : undefined;
      const price = body?.price != null ? Number(body.price) : undefined;
      const uom = body?.uom != null ? String(body.uom) : undefined;
      const taxCode = body?.taxCode != null ? String(body.taxCode) : undefined;
      const kind = parseKind(body?.kind) ?? "good";

      if (!name) return bad("name is required");

      Object.assign(item, { name, sku, price, uom, taxCode, kind });

      // Default list index for products (by type)
      item.gsi1pk = `${tenantId}|product`;
      item.gsi1sk = `name#${name.toLowerCase()}#id#${id}`;

      // If SKU provided, enforce uniqueness with a UNIQ record
      if (sku) {
        const skuLc = sku.toLowerCase();
        item.skuLc = skuLc;

        await ddb.send(new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: tableObjects,
                Item: { pk: uniqPk(tenantId, skuLc), sk: id, id, tenantId, type: "product:sku", createdAt: nowIso },
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

    // ——— Event specifics ———
    if (typeParam === "event") {
      const name = String(body?.name ?? "").trim();
      if (!name) return bad("name is required");
      const startsAt: string | undefined = body?.startsAt ? String(body.startsAt) : undefined;
      const endsAt  : string | undefined = body?.endsAt   ? String(body.endsAt)   : undefined;
      const status  : string | undefined = body?.status   ? String(body.status)   : undefined;

      Object.assign(item, { name, startsAt, endsAt, status });

      // Index for event lists (by start date)
      const startKey = startsAt || nowIso;
      item.gsi1pk = `${tenantId}|event`;
      item.gsi1sk = `startsAt#${startKey}#id#${id}`;

      await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
      return ok(item);
    }

    // ——— Registration specifics ———
    if (typeParam === "registration") {
      const eventId = String(body?.eventId ?? "").trim();
      if (!eventId) return bad("eventId is required");
      const accountId: string | undefined = body?.accountId ? String(body.accountId) : undefined;
      const status   : string | undefined = body?.status     ? String(body.status)     : "pending";

      Object.assign(item, { eventId, accountId, status });

      // Index registrations globally, and enable "by event" via begins_with on gsi1sk
      item.gsi1pk = `${tenantId}|registration`;
      item.gsi1sk = `event#${eventId}#createdAt#${nowIso}#id#${id}`;

      await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
      return ok(item);
    }

    // ——— Default for any other object types ———
    Object.assign(item, body || {});
    item.gsi1pk = `${tenantId}|${typeParam}`;
    item.gsi1sk = `createdAt#${nowIso}#id#${id}`;

    await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
    return ok(item);
  } catch (e: any) {
    if ((e?.name || "").includes("ConditionalCheckFailed")) return conflict("SKU already exists for this tenant");
    return errResp(e);
  }
};
