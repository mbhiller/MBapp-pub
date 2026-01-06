// apps/api/src/common/notify.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createObject, updateObject, getObjectById } from "../objects/repo";
import { sendPostmarkEmail } from "./postmark";

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
 * If simulate mode disabled, send via Postmark and update message accordingly.
 */
export async function enqueueEmail({ tenantId, to, subject, body, metadata, event }: EnqueueEmailArgs) {
  // Validate required fields
  if (!to || !subject || !body) {
    throw new Error("Missing required fields: to, subject, and body are required");
  }

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
  const msgId = (created as any).id as string;

  // In simulate mode, mark as sent immediately
  if (simulateNotifyEnabled(event)) {
    await updateObject({
      tenantId,
      type: "message",
      id: msgId,
      body: { status: "sent", sentAt: new Date().toISOString() },
    });
    return created;
  }

  // Real send mode: send via Postmark
  // Defensive check: don't re-send if already sent
  const current = await getObjectById({ tenantId, type: "message", id: msgId });
  if ((current as any)?.status === "sent") {
    console.log(`[notify] Message ${msgId} already sent, skipping duplicate send`);
    return created;
  }

  // Mark as sending
  await updateObject({
    tenantId,
    type: "message",
    id: msgId,
    body: { status: "sending", lastAttemptAt: new Date().toISOString() },
  });

  try {
    // Send via Postmark
    const result = await sendPostmarkEmail({
      to,
      subject,
      textBody: body,
      event,
    });

    // Success: mark as sent with provider details
    await updateObject({
      tenantId,
      type: "message",
      id: msgId,
      body: {
        status: "sent",
        sentAt: new Date().toISOString(),
        provider: "postmark",
        providerMessageId: result.messageId,
        notes: result.message,
      },
    });

    console.log(`[notify] Email sent via Postmark: ${msgId} → ${result.messageId}`);
  } catch (err: any) {
    // Failure: mark as failed with error details
    const errorMessage = err.message || String(err);
    await updateObject({
      tenantId,
      type: "message",
      id: msgId,
      body: {
        status: "failed",
        provider: "postmark",
        errorMessage,
        lastAttemptAt: new Date().toISOString(),
      },
    });

    console.error(`[notify] Email send failed for ${msgId}: ${errorMessage}`);
  }

  return created;
}
