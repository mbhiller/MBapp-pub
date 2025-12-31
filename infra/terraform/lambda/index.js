// Minimal Objects API for smoke.
// Table: OBJECTS_TABLE, key: pk (id), sk = `${tenant}|${type}`

import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.OBJECTS_TABLE;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const json = (status, body) => ({
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

function lowerHeaders(h) {
  return Object.fromEntries(
    Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), v])
  );
}

function parse(event) {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = event.rawPath ?? event.requestContext?.http?.path ?? "/";
  const h = lowerHeaders(event.headers);
  const tenant = h["x-tenant-id"] || "DemoTenant";
  const qs = Object.fromEntries(new URLSearchParams(event.rawQueryString || ""));
  let body = {};
  try {
    body =
      typeof event.body === "string"
        ? JSON.parse(event.body)
        : event.body ?? {};
  } catch {
    body = {};
  }
  return { method, path, tenant, qs, body };
}

function m(path, re) {
  const t = re.exec(path);
  return t ? t.slice(1) : null;
}

export const handler = async (event) => {
  const { method, path, tenant, qs, body } = parse(event);

  if (method === "OPTIONS") return nocontent();

  // health
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
      const name = body?.name ?? "Test Object";

      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            pk: id,
            sk: `${tenant}|${type}`,
            id,
            type,
            tenant,
            name,
            createdAt: now,
            updatedAt: now,
          },
          ConditionExpression: "attribute_not_exists(pk)",
        })
      );
      return json(200, { id });
    }
  }

  // GET /objects/{type}?id=...  OR  GET /objects/{type}/{id}
  {
    let mm = m(path, /^\/objects\/([^\/]+)$/);
    if (method === "GET" && mm && qs["id"]) {
      const type = decodeURIComponent(mm[0]);
      const id = String(qs["id"]);
      const res = await ddb.send(
        new GetCommand({
          TableName: TABLE,
          Key: { pk: id, sk: `${tenant}|${type}` },
        })
      );
      if (!res.Item) return json(404, { message: "Not found" });
      return json(200, res.Item);
    }

    mm = m(path, /^\/objects\/([^\/]+)\/([^\/]+)$/);
    if (method === "GET" && mm) {
      const [type, id] = mm.map(decodeURIComponent);
      const res = await ddb.send(
        new GetCommand({
          TableName: TABLE,
          Key: { pk: id, sk: `${tenant}|${type}` },
        })
      );
      if (!res.Item) return json(404, { message: "Not found" });
      return json(200, res.Item);
    }
  }

  // PUT /objects/{type}/{id}
  {
    const mm = m(path, /^\/objects\/([^\/]+)\/([^\/]+)$/);
    if (method === "PUT" && mm) {
      const [type, id] = mm.map(decodeURIComponent);
      const name = body?.name ?? "Updated Object";
      const now = Date.now();

      await ddb.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { pk: id, sk: `${tenant}|${type}` },
          UpdateExpression: "SET #n = :n, updatedAt = :u",
          ExpressionAttributeNames: { "#n": "name" },
          ExpressionAttributeValues: { ":n": name, ":u": now },
          ReturnValues: "NONE",
        })
      );
      return json(200, { ok: true });
    }
  }

  // Not used by smoke but present
  if (method === "GET" && path === "/objects/search") {
    return json(200, { ok: true, note: "search stub" });
  }

  return json(404, { message: "Not found" });
};
