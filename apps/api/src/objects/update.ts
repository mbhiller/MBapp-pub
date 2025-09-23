// apps/api/src/objects/update.ts
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
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
    const id = (evt?.pathParameters?.id as string | undefined)?.trim();
    if (!typeParam) return bad("type is required");
    if (!id) return bad("id is required");

    const bodyText = evt?.isBase64Encoded
      ? Buffer.from(evt.body ?? "", "base64").toString("utf8")
      : (evt?.body ?? "{}");

    let patch: any = {};
    try { patch = JSON.parse(bodyText || "{}"); } catch { patch = {}; }

    // Load current
    const curRes = await ddb.send(new GetCommand({
      TableName: tableObjects,
      Key: { pk: id, sk: `${tenantId}|${typeParam}` },
    }));
    const cur = curRes.Item as any;
    if (!cur) return bad("object not found for tenant/type");

    const now = new Date().toISOString();

    // UpdateExpression builder
    const setParts: string[] = ["#updatedAt = :now"];
    const names: Record<string,string> = { "#updatedAt": "updatedAt" };
    const values: Record<string,any> = { ":now": now };
    const setIf = (field: string, value: any) => {
      if (value === undefined) return;
      const nk = `#${field}`, vk = `:${field}`;
      names[nk] = field; values[vk] = value;
      setParts.push(`${nk} = ${vk}`);
    };

    // name/name_lc (if provided)
    const name = typeof patch?.name === "string" ? patch.name.trim() : undefined;
    setIf("name", name);
    setIf("name_lc", name?.toLowerCase());

    // ---------- type-specific ----------
    switch (typeParam) {
      case "product": {
        const price   = patch?.price != null ? toNum(patch.price) : undefined;
        const sku     = typeof patch?.sku === "string" ? patch.sku.trim() : undefined;
        const uom     = toStr(patch?.uom)?.trim();
        const taxCode = toStr(patch?.taxCode)?.trim();
        const kind    = parseKind(patch?.kind);
        const status  = patch?.status != null ? clamp(patch.status, ["active","inactive","archived"] as const, "active") : undefined;
        const notes   = toStr(patch?.notes);

        setIf("price", price);
        setIf("sku", sku);
        setIf("uom", uom);
        setIf("taxCode", taxCode);
        setIf("kind", kind);
        setIf("status", status);
        setIf("notes", notes);

        // Handle SKU token migration if changing
        const curSkuLc = (cur?.sku ?? "").toLowerCase() || undefined;
        const newSkuLc = sku?.toLowerCase();
        const willChangeSku = Boolean(newSkuLc && newSkuLc !== curSkuLc);
        if (willChangeSku) {
          const newToken = { pk: uniqPk(tenantId, newSkuLc!), sk: id, id, tenantId, type: "product:sku", createdAt: now };
          const ops: any[] = [
            { Put: { TableName: tableObjects, Item: newToken, ConditionExpression: "attribute_not_exists(pk)" } },
            {
              Update: {
                TableName: tableObjects,
                Key: { pk: id, sk: `${tenantId}|${typeParam}` },
                UpdateExpression: `SET ${setParts.join(", ")}`,
                ExpressionAttributeNames: names,
                ExpressionAttributeValues: values,
                ConditionExpression: "attribute_exists(pk)",
              }
            }
          ];
          if (curSkuLc) {
            ops.push({ Delete: { TableName: tableObjects, Key: { pk: uniqPk(tenantId, curSkuLc), sk: id } } });
          }
          await ddb.send(new TransactWriteCommand({ TransactItems: ops }));
          return ok({ ...cur, ...patch, updatedAt: now, sku });
        }
        break;
      }

      case "client": {
        setIf("displayName", toStr(patch?.displayName));
        setIf("firstName", toStr(patch?.firstName));
        setIf("lastName", toStr(patch?.lastName));
        setIf("email", toStr(patch?.email));
        setIf("phone", toStr(patch?.phone));
        setIf("status", patch?.status != null ? clamp(patch.status, ["active","inactive","archived"] as const, "active") : undefined);
        setIf("notes", toStr(patch?.notes));
        break;
      }

      case "account": {
        setIf("number", toStr(patch?.number));
        setIf("currency", toStr(patch?.currency));
        setIf("accountType", toStr(patch?.accountType));
        setIf("balance", toNum(patch?.balance));
        setIf("status", patch?.status != null ? clamp(patch.status, ["active","inactive","archived"] as const, "active") : undefined);
        break;
      }

      case "inventory": {
        // productId is optional; keep if provided
        setIf("productId", toStr(patch?.productId)?.trim());
        setIf("name", toStr(patch?.name));
        setIf("sku", toStr(patch?.sku));
        setIf("quantity", toNum(patch?.quantity));
        setIf("uom", toStr(patch?.uom));
        setIf("location", toStr(patch?.location));
        setIf("minQty", toNum(patch?.minQty));
        setIf("maxQty", toNum(patch?.maxQty));
        setIf("status", patch?.status != null ? clamp(patch.status, ["active","inactive","archived"] as const, "active") : undefined);
        setIf("notes", toStr(patch?.notes));
        break;
      }

      case "resource": {
        setIf("code", toStr(patch?.code));
        setIf("url", toStr(patch?.url));
        setIf("expiresAt", toStr(patch?.expiresAt));
        break;
      }

      case "employee": {
        setIf("displayName", toStr(patch?.displayName));
        setIf("email", toStr(patch?.email));
        setIf("phone", toStr(patch?.phone));
        setIf("role", toStr(patch?.role));
        setIf("status", patch?.status != null ? clamp(patch.status, ["active","inactive","terminated"] as const, "active") : undefined);
        setIf("hiredAt", toStr(patch?.hiredAt) ?? toStr(patch?.startDate));
        setIf("startDate", toStr(patch?.startDate) ?? toStr(patch?.hiredAt));
        setIf("terminatedAt", toStr(patch?.terminatedAt));
        setIf("notes", toStr(patch?.notes));
        break;
      }

      case "event": {
        setIf("description", toStr(patch?.description));
        setIf("location", toStr(patch?.location));
        setIf("notes", toStr(patch?.notes));
        setIf("capacity", toNum(patch?.capacity));
        setIf("startsAt", toStr(patch?.startsAt));
        setIf("endsAt", toStr(patch?.endsAt));
        setIf("status", patch?.status != null ? clamp(patch.status, ["available","unavailable","maintenance"] as const, "available") : undefined);
        break;
      }

      case "registration": {
        setIf("eventId", toStr(patch?.eventId)?.trim());
        setIf("clientId", toStr(patch?.clientId)?.trim());
        setIf("startsAt", toStr(patch?.startsAt));
        setIf("endsAt", toStr(patch?.endsAt));
        setIf("registeredAt", toStr(patch?.registeredAt));
        setIf("notes", toStr(patch?.notes));
        // strict enum (no aliases)
        if (patch?.status != null) {
          const s = String(patch.status).trim().toLowerCase();
          if (["pending","confirmed","cancelled","checked_in","completed"].includes(s)) {
            setIf("status", s);
          }
        }
        break;
      }

      case "reservation": {
        const startsAt = toStr(patch?.startsAt) ?? toStr(patch?.start);
        const endsAt   = toStr(patch?.endsAt)   ?? toStr(patch?.end);
        setIf("resourceId", toStr(patch?.resourceId)?.trim());
        setIf("clientId", toStr(patch?.clientId)?.trim());
        setIf("startsAt", startsAt);
        setIf("endsAt", endsAt);
        setIf("start", startsAt);
        setIf("end", endsAt);
        setIf("notes", toStr(patch?.notes));
        if (patch?.status != null) {
          const s = String(patch.status).trim().toLowerCase();
          if (["pending","confirmed","cancelled","checked_in","completed"].includes(s)) {
            setIf("status", s);
          }
        }
        break;
      }

      case "vendor": {
        setIf("displayName", toStr(patch?.displayName));
        setIf("email", toStr(patch?.email));
        setIf("phone", toStr(patch?.phone));
        setIf("notes", toStr(patch?.notes));
        // strict enum (no legacy aliases)
        if (patch?.status != null) {
          const s = String(patch.status).trim().toLowerCase();
          if (["active","inactive","archived"].includes(s)) {
            setIf("status", s);
          }
        }
        break;
      }

      default:
        break;
    }

    // Execute update (always at least touches updatedAt)
    const r = await ddb.send(new UpdateCommand({
      TableName: tableObjects,
      Key: { pk: id, sk: `${tenantId}|${typeParam}` },
      UpdateExpression: `SET ${setParts.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }));
    return ok((r.Attributes ?? {}) as any);

  } catch (e: any) {
    if ((e?.name || "").includes("ConditionalCheckFailed")) {
      return conflict("SKU already exists for this tenant");
    }
    return errResp(e);
  }
};
