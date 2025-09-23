// apps/api/src/objects/create.ts
import { PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad, error as errResp, conflict } from "../common/responses";
import { getTenantId } from "../common/env";

const uniqPk = (tenant: string, skuLc: string) => `UNIQ#${tenant}#product#SKU#${skuLc}`;

// Common helpers
const toStr = (v: any) => (v == null ? undefined : String(v));
const toNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const clamp = <T extends string>(v: any, allowed: readonly T[], fallback: T): T => {
  const s = String(v ?? "").trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
};
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

    // Base item
    const base: any = {
      pk: id,
      sk: `${tenantId}|${typeParam}`,
      id,
      type: typeParam,
      tenantId,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    // ---------- PRODUCT ----------
    if (typeParam === "product") {
      const name = String(body?.name ?? "").trim();
      if (!name) return bad("name is required");

      const sku = toStr(body?.sku)?.trim();
      const item: any = {
        ...base,
        name,
        name_lc: name.toLowerCase(),
        sku,
        price: toNum(body?.price),
        uom: toStr(body?.uom)?.trim(),
        taxCode: toStr(body?.taxCode)?.trim(),
        kind: parseKind(body?.kind) ?? "good",
        status: clamp(body?.status, ["active","inactive","archived"] as const, "active"),
        notes: toStr(body?.notes),
        gsi1pk: `${tenantId}|product`,
        gsi1sk: `createdAt#${nowIso}#id#${id}`,
      };

      if (sku) {
        const skuLc = sku.toLowerCase();
        const token = {
          pk: uniqPk(tenantId, skuLc),
          sk: id,
          id,
          tenantId,
          type: "product:sku",
          createdAt: nowIso,
        };

        await ddb.send(new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: tableObjects, Item: token, ConditionExpression: "attribute_not_exists(pk)" } },
            { Put: { TableName: tableObjects, Item: item } },
          ],
        }));
        return ok(item);
      }

      await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
      return ok(item);
    }

    // ---------- CLIENT ----------
    if (typeParam === "client") {
      const name = String(body?.name ?? "").trim();
      if (!name) return bad("name is required");

      const item: any = {
        ...base,
        name,
        displayName: toStr(body?.displayName),
        firstName: toStr(body?.firstName),
        lastName: toStr(body?.lastName),
        email: toStr(body?.email),
        phone: toStr(body?.phone),
        status: clamp(body?.status, ["active","inactive","archived"] as const, "active"),
        notes: toStr(body?.notes),
        gsi1pk: `${tenantId}|client`,
        gsi1sk: `createdAt#${nowIso}#id#${id}`,
      };
      await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
      return ok(item);
    }

    // ---------- ACCOUNT ----------
    if (typeParam === "account") {
      const name = String(body?.name ?? "").trim();
      if (!name) return bad("name is required");

      const item: any = {
        ...base,
        name,
        number: toStr(body?.number),
        currency: toStr(body?.currency),
        accountType: toStr(body?.accountType),
        balance: toNum(body?.balance),
        status: clamp(body?.status, ["active","inactive","archived"] as const, "active"),
        gsi1pk: `${tenantId}|account`,
        gsi1sk: `createdAt#${nowIso}#id#${id}`,
      };
      await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
      return ok(item);
    }

    // ---------- INVENTORY ----------
    // NOTE: productId is OPTIONAL now; inventory can be standalone or linked to a product
    if (typeParam === "inventory") {
      const name = String(body?.name ?? "").trim();
      if (!name) return bad("name is required"); // require a human-readable name

      const item: any = {
        ...base,
        productId: toStr(body?.productId)?.trim(), // optional link
        name,
        sku: toStr(body?.sku),
        quantity: toNum(body?.quantity),
        uom: toStr(body?.uom),
        location: toStr(body?.location),
        minQty: toNum(body?.minQty),
        maxQty: toNum(body?.maxQty),
        status: clamp(body?.status, ["active","inactive","archived"] as const, "active"),
        notes: toStr(body?.notes),
        gsi1pk: `${tenantId}|inventory`,
        gsi1sk: `createdAt#${nowIso}#id#${id}`,
      };
      await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
      return ok(item);
    }

    // ---------- RESOURCE ----------
    if (typeParam === "resource") {
      const name = String(body?.name ?? "").trim();
      if (!name) return bad("name is required");

      const item: any = {
        ...base,
        name,
        code: toStr(body?.code),
        url: toStr(body?.url),
        expiresAt: toStr(body?.expiresAt),
        gsi1pk: `${tenantId}|resource`,
        gsi1sk: `createdAt#${nowIso}#id#${id}`,
      };
      await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
      return ok(item);
    }

    // ---------- EMPLOYEE ----------
    if (typeParam === "employee") {
      const displayName = String(body?.displayName ?? "").trim();
      if (!displayName) return bad("displayName is required");

      const item: any = {
        ...base,
        displayName,
        email: toStr(body?.email),
        phone: toStr(body?.phone),
        role: toStr(body?.role),
        status: clamp(body?.status, ["active","inactive","terminated"] as const, "active"),
        hiredAt: toStr(body?.hiredAt) ?? toStr(body?.startDate),
        startDate: toStr(body?.startDate) ?? toStr(body?.hiredAt),
        terminatedAt: toStr(body?.terminatedAt),
        notes: toStr(body?.notes),
        gsi1pk: `${tenantId}|employee`,
        gsi1sk: `createdAt#${nowIso}#id#${id}`,
      };
      await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
      return ok(item);
    }

    // ---------- EVENT ----------
    if (typeParam === "event") {
      const name = String(body?.name ?? "").trim();
      if (!name) return bad("name is required");

      const item: any = {
        ...base,
        name,
        name_lc: name.toLowerCase(),
        description: toStr(body?.description),
        location: toStr(body?.location),
        notes: toStr(body?.notes),
        capacity: toNum(body?.capacity),
        startsAt: toStr(body?.startsAt),
        endsAt: toStr(body?.endsAt),
        status: clamp(body?.status, ["available","unavailable","maintenance"] as const, "available"),
        gsi1pk: `${tenantId}|event`,
        gsi1sk: `createdAt#${nowIso}#id#${id}`,
      };
      await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
      return ok(item);
    }

    // ---------- REGISTRATION ----------
    if (typeParam === "registration") {
      const eventId = String(body?.eventId ?? "").trim();
      if (!eventId) return bad("eventId is required");

      const item: any = {
        ...base,
        eventId,
        clientId: toStr(body?.clientId)?.trim(),
        startsAt: toStr(body?.startsAt),
        endsAt: toStr(body?.endsAt),
        registeredAt: toStr(body?.registeredAt),
        notes: toStr(body?.notes),
        status: clamp(body?.status, ["pending","confirmed","cancelled","checked_in","completed"] as const, "pending"),
        gsi1pk: `${tenantId}|registration`,
        gsi1sk: `createdAt#${nowIso}#id#${id}`,
      };
      await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
      return ok(item);
    }

    // ---------- RESERVATION ----------
    if (typeParam === "reservation") {
      const resourceId = String(body?.resourceId ?? "").trim();
      if (!resourceId) return bad("resourceId is required");

      const startsAt = toStr(body?.startsAt) ?? toStr(body?.start);
      const endsAt   = toStr(body?.endsAt)   ?? toStr(body?.end);

      const item: any = {
        ...base,
        resourceId,
        clientId: toStr(body?.clientId)?.trim(),
        startsAt,
        endsAt,
        start: startsAt, end: endsAt, // aliases
        notes: toStr(body?.notes),
        status: clamp(body?.status, ["pending","confirmed","cancelled","checked_in","completed"] as const, "pending"),
        gsi1pk: `${tenantId}|reservation`,
        gsi1sk: `createdAt#${nowIso}#id#${id}`,
      };
      await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
      return ok(item);
    }

    // ---------- VENDOR ----------
    if (typeParam === "vendor") {
      const name = String(body?.name ?? body?.displayName ?? "").trim();
      if (!name) return bad("name is required");

      const item: any = {
        ...base,
        name,
        displayName: toStr(body?.displayName),
        email: toStr(body?.email),
        phone: toStr(body?.phone),
        notes: toStr(body?.notes),
        status: clamp(body?.status, ["active","inactive","archived"] as const, "active"),
        gsi1pk: `${tenantId}|vendor`,
        gsi1sk: `createdAt#${nowIso}#id#${id}`,
      };
      await ddb.send(new PutCommand({ TableName: tableObjects, Item: item }));
      return ok(item);
    }

    // ---------- DEFAULT ----------
    const item: any = { ...base, ...(body || {}) };
    if (typeof item?.name === "string" && item.name) item.name_lc = item.name.toLowerCase();
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
