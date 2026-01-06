// apps/api/src/common/notify.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createObject, updateObject } from "../objects/repo";

export type EnqueueEmailArgs = {
  tenantId: string;
  to: string;
  subject: string;
  body: string;
  metadata?: Record<string, any>;
  event?: APIGatewayProxyEventV2;
};

function simulateNotifyEnabled(event?: APIGatewayProxyEventV2): boolean {
  const h = event?.headers || {};
  const headerVal = h["x-feature-notify-simulate"] || h["X-Feature-Notify-Simulate"];
  const envVal = process.env.FEATURE_NOTIFY_SIMULATE;
  const truthy = (v: any) => String(v).toLowerCase() === "1" || String(v).toLowerCase() === "true";
  return truthy(headerVal) || truthy(envVal);
}

/**
 * Create an email message object with status=queued.
 * If simulate mode enabled, immediately mark as sent and set sentAt.
 */
export async function enqueueEmail({ tenantId, to, subject, body, metadata, event }: EnqueueEmailArgs) {
  const now = new Date().toISOString();
  const msgBody: any = {
    type: "message",
    channel: "email",
    to,
    subject,
    body,
    status: "queued",
    queuedAt: now,
    ...(metadata && { metadata }),
  };

  const created = await createObject({ tenantId, type: "message", body: msgBody });

  // In simulate mode, mark as sent immediately
  if (simulateNotifyEnabled(event)) {
    const msgId = (created as any).id as string;
    await updateObject({
      tenantId,
      type: "message",
      id: msgId,
      body: { status: "sent", sentAt: new Date().toISOString() },
    });
  }

  return created;
}
