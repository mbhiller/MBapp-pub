import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { badRequest, notFound, ok, internalError } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, updateObject } from "../objects/repo";
import { sendPostmarkEmail } from "../common/postmark";
import { sendTwilioSms } from "../common/twilio";

const MESSAGE_FIELDS = [
  "id",
  "type",
  "channel",
  "to",
  "subject",
  "body",
  "status",
  "provider",
  "providerMessageId",
  "errorMessage",
  "lastAttemptAt",
  "sentAt",
  "retryCount",
] as const;

function simulateNotifyEnabled(event?: APIGatewayProxyEventV2): boolean {
  const h = event?.headers || {};
  const headerVal = h["x-feature-notify-simulate"] || h["X-Feature-Notify-Simulate"];
  const envVal = process.env.FEATURE_NOTIFY_SIMULATE;
  const truthy = (v: any) => String(v).toLowerCase() === "1" || String(v).toLowerCase() === "true";
  return truthy(headerVal) || truthy(envVal);
}

function normalizeRetryCount(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return n < 0 ? 0 : n;
}

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const tenantId = getTenantId(event);
    if (!tenantId) {
      return badRequest("tenantId is required", { field: "tenantId" });
    }

    const id = event.pathParameters?.id;
    if (!id) {
      return badRequest("id is required", { field: "id" });
    }

    const msg = await getObjectById({
      tenantId,
      type: "message",
      id,
      fields: MESSAGE_FIELDS as unknown as string[],
    });

    if (!msg || (msg as any).type !== "message") {
      return notFound("Not Found");
    }

    const status = (msg as any).status as string | undefined;
    if (status !== "failed") {
      return badRequest("Message is not retryable", { currentStatus: status });
    }

    const channel = (msg as any).channel as string | undefined;
    if (channel !== "email" && channel !== "sms") {
      return badRequest("Channel not supported for retry", { channel });
    }

    const to = (msg as any).to as string | undefined | null;
    const subject = (msg as any).subject as string | undefined | null;
    const body = (msg as any).body as string | undefined | null;

    if (!to) {
      return badRequest("Recipient is required", { field: "to" });
    }
    if (channel === "email") {
      if (!body) return badRequest("Email body is required", { field: "body" });
      if (!subject) return badRequest("Email subject is required", { field: "subject" });
    }
    if (channel === "sms") {
      if (!body) return badRequest("SMS body is required", { field: "body" });
    }

    const attemptAt = new Date().toISOString();
    const nextRetryCount = normalizeRetryCount((msg as any).retryCount) + 1;

    await updateObject({
      tenantId,
      type: "message",
      id,
      body: {
        status: "sending",
        lastAttemptAt: attemptAt,
        errorMessage: null,
        retryCount: nextRetryCount,
      },
    });

    if (simulateNotifyEnabled(event)) {
      const sentAt = new Date().toISOString();
      const provider = channel === "email" ? "postmark" : "twilio";
      const providerMessageId = `${channel === "email" ? "sim_email" : "sim_sms"}_${Math.random().toString(36).slice(2, 11)}`;
      const updated = await updateObject({
        tenantId,
        type: "message",
        id,
        body: {
          status: "sent",
          sentAt,
          provider,
          providerMessageId,
          errorMessage: null,
          lastAttemptAt: attemptAt,
          retryCount: nextRetryCount,
        },
      });
      return ok(updated);
    }

    if (channel === "email") {
      try {
        const result = await sendPostmarkEmail({
          to,
          subject: subject!,
          textBody: body!,
          event,
        });

        const updated = await updateObject({
          tenantId,
          type: "message",
          id,
          body: {
            status: "sent",
            sentAt: new Date().toISOString(),
            provider: "postmark",
            providerMessageId: result.messageId,
            errorMessage: null,
            lastAttemptAt: attemptAt,
            retryCount: nextRetryCount,
          },
        });
        return ok(updated);
      } catch (err: any) {
        const errorMessage = err?.message || String(err);
        const failed = await updateObject({
          tenantId,
          type: "message",
          id,
          body: {
            status: "failed",
            provider: "postmark",
            errorMessage,
            lastAttemptAt: new Date().toISOString(),
            retryCount: nextRetryCount,
          },
        });
        return ok(failed);
      }
    }

    // channel === "sms"
    try {
      const result = await sendTwilioSms({
        to,
        body: body!,
        event: event as any,
      });

      const updated = await updateObject({
        tenantId,
        type: "message",
        id,
        body: {
          status: "sent",
          sentAt: new Date().toISOString(),
          provider: "twilio",
          providerMessageId: result.sid,
          errorMessage: null,
          lastAttemptAt: attemptAt,
          retryCount: nextRetryCount,
        },
      });
      return ok(updated);
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      const failed = await updateObject({
        tenantId,
        type: "message",
        id,
        body: {
          status: "failed",
          provider: "twilio",
          errorMessage,
          lastAttemptAt: new Date().toISOString(),
          retryCount: nextRetryCount,
        },
      });
      return ok(failed);
    }
  } catch (err) {
    return internalError(err);
  }
}
