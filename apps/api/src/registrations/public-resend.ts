import type { APIGatewayProxyEventV2 } from "aws-lambda";
import crypto from "crypto";
import { badRequest, unauthorized, notFound, ok, internalError } from "../common/responses";
import { getTenantId } from "../common/env";
import { getObjectById, updateObject } from "../objects/repo";
import { guardRegistrations } from "./feature";
import { retryMessageRecord, MESSAGE_FIELDS } from "../messages/retry";

function constantTimeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

type ChannelParam = "email" | "sms" | "both";

const MAX_RESENDS = 3;
const MIN_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

const SAFE_MESSAGE_FIELDS = ["status", "sentAt", "provider", "errorMessage"] as const;

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const guard = guardRegistrations(event);
    if (guard) return guard;

    const tenantId = getTenantId(event);
    if (!tenantId) {
      return badRequest("tenantId is required", { field: "tenantId" });
    }

    const id = event.pathParameters?.id;
    if (!id) {
      return badRequest("id is required", { field: "id" });
    }

    const tokenHeader = event.headers?.["x-mbapp-public-token"] || event.headers?.["X-MBapp-Public-Token"];
    if (!tokenHeader || typeof tokenHeader !== "string") {
      return unauthorized("Missing X-MBapp-Public-Token");
    }

    const channelRaw = event.queryStringParameters?.channel as ChannelParam | undefined;
    const channelValid = channelRaw === "email" || channelRaw === "sms" || channelRaw === "both";
    if (channelRaw && !channelValid) {
      return badRequest("channel must be one of email|sms|both", { field: "channel" });
    }
    const channel: ChannelParam = channelValid ? channelRaw! : "both";

    const registration = await getObjectById({
      tenantId,
      type: "registration",
      id,
      fields: [
        "id",
        "type",
        "publicTokenHash",
        "confirmationMessageId",
        "confirmationSmsMessageId",
        "publicResendCount",
        "publicResendLastAt",
      ],
    });

    if (!registration || (registration as any).type !== "registration") {
      return notFound("Not Found");
    }

    const expectedHash = (registration as any).publicTokenHash as string | undefined;
    if (!expectedHash) {
      return unauthorized("Invalid public token");
    }

    const providedHash = crypto.createHash("sha256").update(tokenHeader).digest("hex");
    if (!constantTimeEqual(expectedHash, providedHash)) {
      return unauthorized("Invalid public token");
    }

    const nowMs = Date.now();
    const resendCount = Number((registration as any).publicResendCount || 0);
    const lastAtStr = (registration as any).publicResendLastAt as string | undefined;
    const lastAtMs = lastAtStr ? new Date(lastAtStr).getTime() : undefined;
    const rateLimited = resendCount >= MAX_RESENDS || (lastAtMs !== undefined && nowMs - lastAtMs < MIN_INTERVAL_MS);

    if (rateLimited) {
      return ok({
        registrationId: (registration as any).id,
        rateLimited: true,
        attempted: { email: false, sms: false },
      });
    }

    const confirmationMessageId = (registration as any).confirmationMessageId as string | undefined;
    const confirmationSmsMessageId = (registration as any).confirmationSmsMessageId as string | undefined;

    const attempted = { email: false, sms: false };
    let emailResult: any = null;
    let smsResult: any = null;

    // Email resend
    if ((channel === "both" || channel === "email") && confirmationMessageId) {
      const emailMsg = await getObjectById({
        tenantId,
        type: "message",
        id: confirmationMessageId,
        fields: MESSAGE_FIELDS as unknown as string[],
      });
      if (emailMsg && (emailMsg as any).status === "failed") {
        attempted.email = true;
        emailResult = await retryMessageRecord({ tenantId, msg: emailMsg as any, event });
      } else {
        emailResult = emailMsg;
      }
    }

    // SMS resend
    if ((channel === "both" || channel === "sms") && confirmationSmsMessageId) {
      const smsMsg = await getObjectById({
        tenantId,
        type: "message",
        id: confirmationSmsMessageId,
        fields: MESSAGE_FIELDS as unknown as string[],
      });
      if (smsMsg && (smsMsg as any).status === "failed") {
        attempted.sms = true;
        smsResult = await retryMessageRecord({ tenantId, msg: smsMsg as any, event });
      } else {
        smsResult = smsMsg;
      }
    }

    if (attempted.email || attempted.sms) {
      await updateObject({
        tenantId,
        type: "registration",
        id,
        body: {
          publicResendCount: resendCount + 1,
          publicResendLastAt: new Date(nowMs).toISOString(),
        },
      });
    }

    const response = {
      registrationId: (registration as any).id,
      email: projectSafe(emailResult),
      sms: projectSafe(smsResult),
      attempted,
      rateLimited: false,
    };

    return ok(response);
  } catch (err) {
    if ((err as any)?.statusCode === 400) {
      return badRequest((err as any)?.message || "Bad Request", (err as any)?.details);
    }
    return internalError(err);
  }
}

function projectSafe(msg: any) {
  if (!msg) return null;
  const out: any = {};
  for (const key of SAFE_MESSAGE_FIELDS) {
    if ((msg as any)[key] !== undefined) {
      out[key] = (msg as any)[key];
    }
  }
  return Object.keys(out).length ? out : null;
}