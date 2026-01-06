import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { badRequest, notFound, ok, internalError } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, updateObject } from "../objects/repo";
import { sendPostmarkEmail } from "../common/postmark";
import { sendTwilioSms } from "../common/twilio";

export const MESSAGE_FIELDS = [
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

type MessageRecord = Record<string, any>;

export async function retryMessageRecord({
  tenantId,
  msg,
  event,
}: {
  tenantId: string;
  msg: MessageRecord;
  event?: APIGatewayProxyEventV2;
}) {
  const status = (msg as any).status as string | undefined;
  if (status !== "failed") {
    const err: any = new Error("Message is not retryable");
    err.statusCode = 400;
    err.details = { currentStatus: status };
    throw err;
  }

  const channel = (msg as any).channel as string | undefined;
  if (channel !== "email" && channel !== "sms") {
    const err: any = new Error("Channel not supported for retry");
    err.statusCode = 400;
    err.details = { channel };
    throw err;
  }

  const to = (msg as any).to as string | undefined | null;
  const subject = (msg as any).subject as string | undefined | null;
  const body = (msg as any).body as string | undefined | null;

  if (!to) {
    const err: any = new Error("Recipient is required");
    err.statusCode = 400;
    err.details = { field: "to" };
    throw err;
  }
  if (channel === "email") {
    if (!body) {
      const err: any = new Error("Email body is required");
      err.statusCode = 400;
      err.details = { field: "body" };
      throw err;
    }
    if (!subject) {
      const err: any = new Error("Email subject is required");
      err.statusCode = 400;
      err.details = { field: "subject" };
      throw err;
    }
  }
  if (channel === "sms") {
    if (!body) {
      const err: any = new Error("SMS body is required");
      err.statusCode = 400;
      err.details = { field: "body" };
      throw err;
    }
  }

  const id = (msg as any).id as string;
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
    return await updateObject({
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
  }

  if (channel === "email") {
    try {
      const result = await sendPostmarkEmail({
        to,
        subject: subject!,
        textBody: body!,
        event,
      });

      return await updateObject({
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
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      return await updateObject({
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
    }
  }

  // channel === "sms"
  try {
    const result = await sendTwilioSms({
      to,
      body: body!,
      event: event as any,
    });

    return await updateObject({
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
  } catch (err: any) {
    const errorMessage = err?.message || String(err);
    return await updateObject({
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
  }
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

    const result = await retryMessageRecord({ tenantId, msg, event });
    return ok(result);
  } catch (err) {
    if ((err as any)?.statusCode === 400) {
      return badRequest((err as any)?.message || "Bad Request", (err as any)?.details);
    }
    return internalError(err);
  }
}
