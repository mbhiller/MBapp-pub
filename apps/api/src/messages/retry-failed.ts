import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, badRequest, internalError } from "../common/responses";
import { getAuth, requirePerm } from "../auth/middleware";
import { parsePagination, buildListPage } from "../shared/pagination";
import { listObjects } from "../objects/repo";
import { retryMessageRecord, MESSAGE_FIELDS } from "./retry";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const auth = await getAuth(event);
    requirePerm(auth, "message:write");

    const qsp = event.queryStringParameters || {};
    const parsed = parsePagination(qsp, DEFAULT_LIMIT);
    const limit = Math.min(Math.max(parsed.limit, 1), MAX_LIMIT);
    const cursor = parsed.cursor;

    const channel = qsp.channel ? String(qsp.channel).trim() : undefined;
    const provider = qsp.provider ? String(qsp.provider).trim() : undefined;

    const filters: Record<string, string> = { status: "failed" };
    if (channel) filters.channel = channel;
    if (provider) filters.provider = provider;

    const page = await listObjects({
      tenantId: auth.tenantId,
      type: "message",
      limit,
      next: cursor,
      filters,
      fields: MESSAGE_FIELDS as unknown as string[],
    });

    const items = [] as any[];

    for (const msg of page.items || []) {
      if ((msg as any)?.status !== "failed") {
        continue;
      }
      try {
        const updated = await retryMessageRecord({ tenantId: auth.tenantId, msg, event });
        items.push(projectResult(updated));
      } catch (err: any) {
        // Skip non-retryable or unexpected errors without failing the batch; surface errorMessage if available
        const safeMsg = err?.message || "retry_failed";
        items.push({
          id: (msg as any)?.id,
          status: (msg as any)?.status,
          retryCount: (msg as any)?.retryCount,
          lastAttemptAt: (msg as any)?.lastAttemptAt,
          sentAt: (msg as any)?.sentAt,
          provider: (msg as any)?.provider,
          errorMessage: safeMsg,
        });
      }
    }

    return ok(buildListPage(items, page.next ?? null));
  } catch (err) {
    return internalError(err);
  }
}

function projectResult(msg: any) {
  return {
    id: msg?.id,
    status: msg?.status,
    retryCount: msg?.retryCount,
    lastAttemptAt: msg?.lastAttemptAt,
    sentAt: msg?.sentAt,
    provider: msg?.provider,
    errorMessage: msg?.errorMessage,
  };
}
