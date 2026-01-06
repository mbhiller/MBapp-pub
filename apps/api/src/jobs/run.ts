import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, internalError } from "../common/responses";
import { runBackgroundJobs } from "./background";

type JobType = "cleanup-expired-holds" | "retry-failed-messages" | "all";

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const q = event.queryStringParameters || {};
    const bodyRaw = event.body ? safeParse(event.body) : {};

    const jobType = normalizeJobType((bodyRaw?.jobType ?? q.jobType) as any);
    if (!jobType) {
      return badRequest("jobType is required and must be one of cleanup-expired-holds | retry-failed-messages | all", {
        allowed: ["cleanup-expired-holds", "retry-failed-messages", "all"],
      });
    }

    const tenantId = String((bodyRaw?.tenantId ?? q.tenantId ?? "")).trim() || undefined;
    const limit = toInt(bodyRaw?.limit ?? q.limit);

    if (jobType === "all") {
      const groupA = await runBackgroundJobs({ jobType: "cleanup-expired-holds", ...(limit ? { limit } : {}), ...(tenantId ? { tenants: [tenantId] } : {}), event });
      const groupB = await runBackgroundJobs({ jobType: "retry-failed-messages", ...(limit ? { limit } : {}), ...(tenantId ? { tenants: [tenantId] } : {}), event });
      const flattened = [...groupA.results, ...groupB.results];
      return ok({ results: flattened });
    }

    const group = await runBackgroundJobs({ jobType: jobType as any, ...(limit ? { limit } : {}), ...(tenantId ? { tenants: [tenantId] } : {}), event });
    return ok({ results: group.results });
  } catch (err) {
    return internalError(err);
  }
}

function safeParse(body: string | object | null | undefined): any {
  if (!body) return {};
  if (typeof body === "object") return body;
  try { return JSON.parse(body); } catch { return {}; }
}

function toInt(v: any): number | undefined {
  if (v == null || v === "") return undefined;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function normalizeJobType(v: any): JobType | null {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "cleanup-expired-holds") return "cleanup-expired-holds";
  if (s === "retry-failed-messages") return "retry-failed-messages";
  if (s === "all") return "all";
  return null;
}
