import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import { ddb, tableObjects } from "../common/ddb";
import { ok, bad } from "../common/responses";
import { getTenantId } from "../common/env";
import { MBObject } from "./types";

export const handler = async (evt: any) => {
  const tenantId = getTenantId(evt);
  let body: any;
  try {
    body = JSON.parse(evt.body || "{}");
  } catch {
    return bad("invalid JSON body");
  }

  if (!body.type || !body.name) return bad("type and name are required");

  const id = `obj_${uuid()}`;
  const now = new Date().toISOString();

  const item = {
    pk: `tenant#${tenantId}`,
    sk: `obj#${body.type}#${id}`,
    type: body.type,
    name: body.name,
    integrations: body.integrations || {},
    metadata: body.metadata || {},
    tags: body.tags || {},
    gsi1pk: `type#${body.type}#tenant#${tenantId}`,
    gsi1sk: now,
    ...(body?.tags?.rfidEpc ? { gsi2pk: `tag#${body.tags.rfidEpc}`, gsi2sk: `tenant#${tenantId}` } : {}),
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({
    TableName: tableObjects,
    Item: item,
    ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
  }));

  return ok({ id });
};