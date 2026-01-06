import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { listObjects } from "../objects/repo";
import { expireRegistrationHold } from "../registrations/expire-helper";
import { MESSAGE_FIELDS, retryMessageRecord } from "../messages/retry";
import { featureRegistrationsEnabled, IS_PROD } from "../flags";

type JobType = "cleanup-expired-holds" | "retry-failed-messages";

type TenantJobResult = {
  jobType: JobType;
  tenantId: string;
  ok: boolean;
  counts: Record<string, number>;
  errorMessage?: string;
};

type RunArgs = {
  jobType: JobType;
  limit?: number;
  tenants?: string[];
  event?: APIGatewayProxyEventV2;
};

function envTrue(name: string): boolean {
  const v = process.env[name];
  if (v == null) return false;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function parseTenants(explicit?: string[]): string[] {
  if (explicit && explicit.length) return explicit;
  const raw = process.env.MBAPP_JOB_TENANTS || "SmokeTenant,DemoTenant";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildSimulatedEvent(tenantId: string): APIGatewayProxyEventV2 {
  const headers: Record<string, string> = {
    "x-tenant-id": tenantId,
  };
  // In non-PROD, default to simulate notifications to keep jobs safe.
  // Also honor FEATURE_NOTIFY_SIMULATE env if set.
  if (!IS_PROD || envTrue("FEATURE_NOTIFY_SIMULATE")) {
    headers["X-Feature-Notify-Simulate"] = "true";
  }
  // Feature flags can be overridden via headers in non-prod, but for safety we rely on env here.
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/jobs/background",
    rawQueryString: "",
    headers,
    requestContext: {} as any,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

async function runCleanupExpiredHolds(tenantId: string, limit: number, event?: APIGatewayProxyEventV2): Promise<TenantJobResult> {
  try {
    // Respect registrations feature flag; skip if disabled.
    const featureOn = featureRegistrationsEnabled(event ?? buildSimulatedEvent(tenantId));
    if (!featureOn) {
      console.log(`[jobs] cleanup-expired-holds skipped for tenant=${tenantId} (feature disabled)`);
      return { jobType: "cleanup-expired-holds", tenantId, ok: true, counts: { skippedFeatureDisabled: 1 } };
    }

    const page = await listObjects({
      tenantId,
      type: "registration",
      filters: { status: "submitted" },
      limit: Math.max(1, Math.min(limit, 200)),
      fields: ["id", "status", "holdExpiresAt", "eventId"],
    });

    const nowMs = Date.now();
    let examined = 0;
    let expired = 0;

    for (const item of (page.items as any[]) || []) {
      examined += 1;
      const id = item?.id as string | undefined;
      const status = item?.status as string | undefined;
      const hold = item?.holdExpiresAt as string | undefined;
      const holdMs = hold ? new Date(hold).getTime() : undefined;
      if (!id || status !== "submitted") continue;
      if (holdMs === undefined || holdMs >= nowMs) continue;

      const res = await expireRegistrationHold({ tenantId, regId: id });
      if (res.expired) expired += 1;
    }

    console.log(`[jobs] cleanup-expired-holds tenant=${tenantId} examined=${examined} expired=${expired}`);
    return { jobType: "cleanup-expired-holds", tenantId, ok: true, counts: { examined, expired } };
  } catch (err: any) {
    console.error(`[jobs] cleanup-expired-holds error tenant=${tenantId}`, err?.message || err);
    return { jobType: "cleanup-expired-holds", tenantId, ok: false, counts: {}, errorMessage: err?.message || String(err) };
  }
}

async function runRetryFailedMessages(tenantId: string, limit: number): Promise<TenantJobResult> {
  try {
    const page = await listObjects({
      tenantId,
      type: "message",
      filters: { status: "failed" },
      limit: Math.max(1, Math.min(limit, 50)),
      fields: MESSAGE_FIELDS as unknown as string[],
    });

    const event = buildSimulatedEvent(tenantId);
    let examined = 0;
    let attempted = 0;
    let sent = 0;
    let failed = 0;

    for (const msg of page.items || []) {
      examined += 1;
      if ((msg as any)?.status !== "failed") continue;
      attempted += 1;
      try {
        const updated = await retryMessageRecord({ tenantId, msg: msg as any, event });
        const status = (updated as any)?.status;
        if (status === "sent") sent += 1;
        else if (status === "failed") failed += 1;
      } catch (e: any) {
        failed += 1;
      }
    }

    console.log(`[jobs] retry-failed-messages tenant=${tenantId} examined=${examined} attempted=${attempted} sent=${sent} failed=${failed}`);
    return { jobType: "retry-failed-messages", tenantId, ok: true, counts: { examined, attempted, sent, failed } };
  } catch (err: any) {
    console.error(`[jobs] retry-failed-messages error tenant=${tenantId}`, err?.message || err);
    return { jobType: "retry-failed-messages", tenantId, ok: false, counts: {}, errorMessage: err?.message || String(err) };
  }
}

export async function runBackgroundJobs({ jobType, limit, tenants, event }: RunArgs) {
  const tenantIds = parseTenants(tenants);
  // Per-job defaults + env overrides
  const resolvedLimit = (() => {
    if (typeof limit === "number" && Number.isFinite(limit)) return Math.max(1, Math.floor(limit));
    const envName = jobType === "cleanup-expired-holds" ? "MBAPP_JOB_LIMIT_CLEANUP_HOLDS" : "MBAPP_JOB_LIMIT_RETRY_FAILED";
    const envVal = process.env[envName] ? parseInt(String(process.env[envName]!), 10) : NaN;
    if (Number.isFinite(envVal)) return Math.max(1, envVal);
    return jobType === "cleanup-expired-holds" ? 50 : 25;
  })();

  const results: TenantJobResult[] = [];
  console.log(`[jobs] start jobType=${jobType} tenants=${tenantIds.join(",")} limit=${resolvedLimit}`);
  for (const t of tenantIds) {
    if (jobType === "cleanup-expired-holds") {
      results.push(await runCleanupExpiredHolds(t, resolvedLimit, event));
    } else if (jobType === "retry-failed-messages") {
      results.push(await runRetryFailedMessages(t, resolvedLimit));
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const errCount = results.length - okCount;
  console.log(`[jobs] done jobType=${jobType} ok=${okCount} errors=${errCount}`);
  return { jobType, results };
}
