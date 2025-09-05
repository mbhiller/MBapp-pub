// infra/lambda/index.ts
// Minimal Objects API for smoke (real handler).
// DynamoDB table: OBJECTS_TABLE
// Keys: pk = id (uuid), sk = `${tenant}|${type}`

import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

type APIGWEvent = {
  rawPath?: string;
  rawQueryString?: string;
  requestContext?: { http?: { method?: string; path?: string } };
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
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

const nocontent = (status = 204) => ({
  statusCode: status,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  },
  body: "",
});

function lower(h?: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
}
function parse(event: APIGWEvent) {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = event.rawPath ?? event.requestContext?.http?.path ?? "/";
  const headers = lower(event.headers);
  const tenant = headers["x-tenant-id"] || "DemoTenant";
  const qs = Object.fromEntries(new URLSearchParams(event.rawQueryString || ""));
  let body: any = {};
  try { body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body ?? {}); } catch {}
  return { method, path, tenant, qs, body };
}
const m = (path: string, re: RegExp) => (re.exec(path)?.slice(1) ?? null);

export const handler = async (event: APIGWEvent) => {
  const { method, path, tenant, qs, body } = parse(event);

  if (method === "OPTIONS") return nocontent();

  if (method === "GET" && path === "/tenants") {
    return json(200, [{ id: "DemoTenant" }]);
  }

  // POST /objects/{type}
  {
    const mm = m(path, /^\/objects\/([^\/]+)$/);
    if (method === "POST" && mm) {
      const type = decodeURIComponent(mm[0]);
      const id = randomUUID();
      const now = Date.now();
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: {
          pk: id, sk: `${tenant}|${type}`,
          id, type, tenant,
          name: body?.name ?? "Test Object",
          createdAt: now, updatedAt: now
        },
        ConditionExpression: "attribute_not_exists(pk)"
      }));
      return json(200, { id });
    }
  }

  // GET /objects/{type}?id=... OR /objects/{type}/{id}
  {
    let mm = m(path, /^\/objects\/([^\/]+)$/);
    if (method === "GET" && mm && qs["id"]) {
      const type = decodeURIComponent(mm[0]);
      const id = String(qs["id"]);
      const res = await ddb.send(new GetCommand({
        TableName: TABLE, Key: { pk: id, sk: `${tenant}|${type}` }
      }));
      if (!res.Item) return json(404, { message: "Not found" });
      return json(200, res.Item);
    }
    mm = m(path, /^\/objects\/([^\/]+)\/([^\/]+)$/);
    if (method === "GET" && mm) {
      const [type, id] = mm.map(decodeURIComponent);
      const res = await ddb.send(new GetCommand({
        TableName: TABLE, Key: { pk: id, sk: `${tenant}|${type}` }
      }));
      if (!res.Item) return json(404, { message: "Not found" });
      return json(200, res.Item);
    }
  }

  // PUT /objects/{type}/{id}
  {
    const mm = m(path, /^\/objects\/([^\/]+)\/([^\/]+)$/);
    if (method === "PUT" && mm) {
      const [type, id] = mm.map(decodeURIComponent);
      const now = Date.now();
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: id, sk: `${tenant}|${type}` },
        UpdateExpression: "SET #n = :n, updatedAt = :u",
        ExpressionAttributeNames: { "#n": "name" },
        ExpressionAttributeValues: { ":n": (body?.name ?? "Updated Object"), ":u": now },
        ReturnValues: "NONE"
      }));
      return json(200, { ok: true });
    }
  }

  if (method === "GET" && path === "/objects/search") {
    return json(200, { ok: true, note: "search stub" });
  }

  return json(404, { message: "Not found" });
};
