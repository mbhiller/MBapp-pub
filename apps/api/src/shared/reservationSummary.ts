// apps/api/src/shared/reservationSummary.ts
import { ddb, tableObjects } from "../common/ddb";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

export async function netReservationsForSO(
  tenantId: string,
  soId: string
): Promise<{ net: number; fulfilled: boolean }> {
  let net = 0;
  let fulfilled = false;
  let lastKey: Record<string, any> | undefined;

  do {
    const q = await ddb.send(new QueryCommand({
      TableName: tableObjects,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :pref)",
      ExpressionAttributeValues: { ":pk": tenantId, ":pref": "inventoryMovement#" },
      // 'action' is reserved, so alias it:
      ProjectionExpression: "#soId, #action, #qty",
      ExpressionAttributeNames: { "#soId": "soId", "#action": "action", "#qty": "qty" },
      ExclusiveStartKey: lastKey,
    }));

    for (const it of q.Items ?? []) {
      if ((it as any).soId !== soId) continue;
      const a = String((it as any).action);
      const qty = Number((it as any).qty ?? 0);
      if (a === "reserve")  net += qty;
      if (a === "release")  net -= qty;
      if (a === "fulfill" && qty > 0) fulfilled = true;
    }

    lastKey = (q as any).LastEvaluatedKey;
  } while (lastKey);

  return { net, fulfilled };
}
