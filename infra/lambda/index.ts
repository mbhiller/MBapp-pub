// Objects API: POST/GET/PUT/DELETE + list + search(tag)
// Keys: pk = id (uuid), sk = `${tenant}|${type}`
// GSI1: gsi1pk (HASH), gsi1sk (RANGE, **S**) → list by type
// GSI2: gsi2pk (HASH), gsi2sk (RANGE, **S**) → search by tag

import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

type APIGWEvent = {
  rawPath?: string;
  rawQueryString?: string;
  requestContext?: { http?: { method?: string; path?: string }, routeKey?: string };
  headers?: Record<string, string | undefined>;
  body?: string | object | null;
};

const TABLE = process.env.OBJECTS_TABLE!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const json = (status: number, body: unknown) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

const nocontent = (status = 204) => ({
  statusCode: status,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  },
  body: "",
});

const b64e = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const b64d = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString());
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function lower(h?: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
}
function parse(event: APIGWEvent) {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = event.rawPath ?? event.requestContext?.http?.path ?? "/";
  const routeKey = event.requestContext?.routeKey ?? "";
  const headers = lower(event.headers);
  const tenant = headers["x-tenant-id"] || "DemoTenant";
  const qs = Object.fromEntries(new URLSearchParams(event.rawQueryString || ""));
  let body: any = {};
  try { body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body ?? {}); } catch {}
  return { method, path, routeKey, tenant, qs, body };
}
const m = (path: string, re: RegExp) => (re.exec(path)?.slice(1) ?? null);

export const handler = async (event: APIGWEvent) => {
  try {
    const { method, path, routeKey, tenant, qs, body } = parse(event);

    if (method === "OPTIONS") return nocontent();

    // Health
    if (method === "GET" && path === "/tenants") {
      return json(200, [{ id: "DemoTenant" }]);
    }

    // --- PRIORITIZE NON-CONFLICTING ROUTES FIRST ---

    // LIST: GET /objects/{type}/list
    if (routeKey === "GET /objects/{type}/list" || /^\/objects\/[^\/]+\/list$/.test(path)) {
      const type = decodeURIComponent((m(path, /^\/objects\/([^\/]+)\/list$/) ?? [""])[0]);
      const limit = clamp(parseInt(String(qs["limit"] ?? "10"), 10) || 10, 1, 100);
      const startKey = qs["cursor"] ? b64d(String(qs["cursor"])) : undefined;

      const r = await ddb.send(new QueryCommand({
        TableName: TABLE,
        IndexName: "gsi1",
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": `${tenant}|${type}` },
        ScanIndexForward: false,
        Limit: limit,
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }));
      return json(200, { items: r.Items ?? [], cursor: r.LastEvaluatedKey ? b64e(r.LastEvaluatedKey) : null });
    }

    // SEARCH: GET /objects/search?tag=...
    if (method === "GET" && path === "/objects/search") {
      const tag = (qs["tag"] ?? "").toString().trim();
      if (!tag) return json(400, { message: "Missing 'tag' query param" });

      const limit = clamp(parseInt(String(qs["limit"] ?? "10"), 10) || 10, 1, 100);
      const startKey = qs["cursor"] ? b64d(String(qs["cursor"])) : undefined;

      const r = await ddb.send(new QueryCommand({
        TableName: TABLE,
        IndexName: "gsi2",
        KeyConditionExpression: "gsi2pk = :pk",
        ExpressionAttributeValues: { ":pk": `${tenant}|tag#${tag}` },
        ScanIndexForward: false,
        Limit: limit,
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }));
      return json(200, { items: r.Items ?? [], cursor: r.LastEvaluatedKey ? b64e(r.LastEvaluatedKey) : null });
    }

    // CREATE: POST /objects/{type}
    if (method === "POST" && (routeKey === "POST /objects/{type}" || /^\/objects\/[^\/]+$/.test(path))) {
      const type = decodeURIComponent((m(path, /^\/objects\/([^\/]+)$/) ?? [""])[0]);
      const id = randomUUID();
      const now = Date.now();
      const nowStr = String(now).padStart(13, "0"); // <<--- STRING sort key for GSIs
      const name = body?.name ?? "Test Object";
      const tag: string | undefined = body?.tag;

      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: {
          pk: id, sk: `${tenant}|${type}`,
          id, type, tenant,
          name,
          tag: tag ?? null,
          createdAt: now, updatedAt: now,      // numeric fields kept for app use
          gsi1pk: `${tenant}|${type}`, gsi1sk: nowStr, // <<--- STRINGs for GSIs
          ...(tag ? { gsi2pk: `${tenant}|tag#${tag}`, gsi2sk: nowStr } : {}),
        },
        ConditionExpression: "attribute_not_exists(pk)",
      }));
      return json(200, { id });
    }

    // UPDATE: PUT /objects/{type}/{id}
    if (method === "PUT" && (routeKey === "PUT /objects/{type}/{id}" || /^\/objects\/[^\/]+\/[^\/]+$/.test(path))) {
      const [type, id] = (m(path, /^\/objects\/([^\/]+)\/([^\/]+)$/) ?? ["",""]).map(decodeURIComponent);
      const name = body?.name ?? "Updated Object";
      const now = Date.now();

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: id, sk: `${tenant}|${type}` },
        UpdateExpression: "SET #n = :n, updatedAt = :u",
        ExpressionAttributeNames: { "#n": "name" },
        ExpressionAttributeValues: { ":n": name, ":u": now },
        ReturnValues: "NONE",
      }));
      return json(200, { ok: true });
    }

    // DELETE: DELETE /objects/{type}/{id}
    if (method === "DELETE" && (routeKey === "DELETE /objects/{type}/{id}" || /^\/objects\/[^\/]+\/[^\/]+$/.test(path))) {
      const [type, id] = (m(path, /^\/objects\/([^\/]+)\/([^\/]+)$/) ?? ["",""]).map(decodeURIComponent);
      await ddb.send(new DeleteCommand({
        TableName: TABLE,
        Key: { pk: id, sk: `${tenant}|${type}` },
      }));
      return nocontent(204);
    }

    // READ by query: GET /objects/{type}?id=...
    if (method === "GET" && (routeKey === "GET /objects/{type}" || /^\/objects\/[^\/]+$/.test(path)) && qs["id"]) {
      const type = decodeURIComponent((m(path, /^\/objects\/([^\/]+)$/) ?? [""])[0]);
      const id = String(qs["id"]);
      const res = await ddb.send(new GetCommand({
        TableName: TABLE,
        Key: { pk: id, sk: `${tenant}|${type}` },
      }));
      if (!res.Item) return json(404, { message: "Not found" });
      return json(200, res.Item);
    }

    // READ by path: GET /objects/{type}/{id}
    if (method === "GET" && (routeKey === "GET /objects/{type}/{id}" || /^\/objects\/[^\/]+\/[^\/]+$/.test(path))) {
      const [type, id] = (m(path, /^\/objects\/([^\/]+)\/([^\/]+)$/) ?? ["",""]).map(decodeURIComponent);
      const res = await ddb.send(new GetCommand({
        TableName: TABLE,
        Key: { pk: id, sk: `${tenant}|${type}` },
      }));
      if (!res.Item) return json(404, { message: "Not found" });
      return json(200, res.Item);
    }

    return json(404, { message: "Not found" });
  } catch (err: any) {
    console.error("Handler error:", err);
    return json(500, { message: "Internal Server Error", code: err?.name, detail: err?.message });
  }
};
