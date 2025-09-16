/* Backfill gsi1sk for Products & Events to createdAt-based keys.
   Usage:
     # dry run (default)
     npx ts-node apps/api/scripts/backfill-sort-keys.ts --table <TABLE_NAME> --profile mbapp-nonprod-admin --region us-east-1

     # do the writes
     npx ts-node apps/api/scripts/backfill-sort-keys.ts --table <TABLE_NAME> --profile mbapp-nonprod-admin --region us-east-1 --write

   It updates:
     - product items where gsi1sk begins_with "name#"
     - event   items where gsi1sk begins_with "startsAt#"
*/
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

function arg(flag: string, def?: string) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function has(flag: string) {
  return process.argv.includes(flag);
}

const table = arg("--table");
const region = arg("--region", process.env.AWS_REGION || "us-east-1");
const profile = arg("--profile", process.env.AWS_PROFILE);
const doWrite = has("--write"); // default dry-run

if (!table) {
  console.error("Missing --table <TABLE_NAME>");
  process.exit(1);
}

if (profile) process.env.AWS_PROFILE = profile;
process.env.AWS_REGION = region;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type ObjItem = {
  pk: string;   // id
  sk: string;   // tenant|type
  id?: string;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  gsi1sk?: string;
};

function needsBackfill(it: ObjItem): false | { prefix: "name#" | "startsAt#"; type: "product" | "event" } {
  if (it.type === "product" && (it.gsi1sk || "").startsWith("name#")) {
    return { prefix: "name#", type: "product" };
  }
  if (it.type === "event" && (it.gsi1sk || "").startsWith("startsAt#")) {
    return { prefix: "startsAt#", type: "event" };
  }
  return false;
}

function newGsi1sk(it: ObjItem): string {
  const id = it.id || it.pk;
  const iso = it.createdAt || it.updatedAt || new Date().toISOString();
  return `createdAt#${iso}#id#${id}`;
}

async function* scanNeedingBackfill(): AsyncGenerator<ObjItem[]> {
  let ExclusiveStartKey: any = undefined;
  const FilterExpression =
    "(#t = :product AND begins_with(gsi1sk, :name)) OR (#t = :event AND begins_with(gsi1sk, :starts))";
  const ExpressionAttributeNames = { "#t": "type" };
  const ExpressionAttributeValues = {
    ":product": "product",
    ":event": "event",
    ":name": "name#",
    ":starts": "startsAt#",
  };
  const ProjectionExpression = "pk, sk, #t, id, createdAt, updatedAt, gsi1sk";

  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: table,
        FilterExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        ProjectionExpression,
        ExclusiveStartKey,
        Limit: 100, // page size
      })
    );
    ExclusiveStartKey = r.LastEvaluatedKey;
    const items = (r.Items || []) as ObjItem[];
    yield items;
  } while (ExclusiveStartKey);
}

async function main() {
  let examined = 0;
  let planned = 0;
  let updated = 0;
  for await (const page of scanNeedingBackfill()) {
    for (const it of page) {
      examined++;
      const need = needsBackfill(it);
      if (!need) continue;
      planned++;

      const next = newGsi1sk(it);

      console.log(
        `${doWrite ? "[UPDATE]" : "[DRY]  "} ${it.type}  pk=${it.pk}  old=${it.gsi1sk}  ->  new=${next}`
      );

      if (!doWrite) continue;

      try {
        await ddb.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk: it.pk, sk: it.sk },
            UpdateExpression: "SET gsi1sk = :new",
            ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk) AND begins_with(gsi1sk, :oldprefix)",
            ExpressionAttributeValues: { ":new": next, ":oldprefix": need.prefix },
          })
        );
        updated++;
        // light pacing to be friendly
        await new Promise((r) => setTimeout(r, 25));
      } catch (e: any) {
        console.error("  !! update failed", e?.name || "", e?.message || e);
      }
    }
  }

  console.log(`\nExamined: ${examined}`);
  console.log(`Needing backfill: ${planned}`);
  console.log(`${doWrite ? "Updated" : "Would update"}: ${updated || planned}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
