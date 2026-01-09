import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, bad, error } from "../common/responses";
import { listRegistrationsByEventId } from "../objects/repo";
import type { components } from "../generated/openapi-types";

const MAX_BACKEND_PAGES = 10;
const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 200;

const STATUS_ALLOWLIST = new Set(["draft", "submitted", "confirmed", "cancelled"]);

type Registration = components["schemas"]["Registration"];
type CheckInWorklistPage = components["schemas"]["CheckInWorklistPage"];
type CheckInStatus = components["schemas"]["CheckInStatus"];

function parseBoolean(value: string | undefined): boolean | null | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return null; // signal invalid
}

function matchesCheckedIn(reg: Registration, checkedIn: boolean): boolean {
  const timestamp = (reg as any)?.checkedInAt as string | undefined | null;
  const isCheckedIn = !!timestamp;
  return checkedIn ? isCheckedIn : !isCheckedIn;
}

function matchesReadyFilter(checkInStatus: CheckInStatus | undefined, readyFilter: boolean | null): boolean {
  if (readyFilter === null || readyFilter === undefined) return true;
  const ready = checkInStatus?.ready === true;
  return readyFilter ? ready : !ready;
}

function matchesBlockerFilter(checkInStatus: CheckInStatus | undefined, blockerCodes: Set<string>, readyFilter: boolean | null): boolean {
  if (blockerCodes.size === 0) return true;
  // Only apply blocker filtering when ready is not explicitly true
  if (readyFilter === true) return true;

  const blockers = Array.isArray(checkInStatus?.blockers) ? checkInStatus!.blockers! : [];
  for (const blocker of blockers) {
    const code = typeof blocker?.code === "string" ? blocker.code.toLowerCase() : "";
    if (code && blockerCodes.has(code)) return true;
  }
  return false;
}

function matchesStatus(reg: Registration, statusFilter: string | null): boolean {
  if (!statusFilter) return true;
  return String(reg.status || "") === statusFilter;
}

function matchesQuery(reg: Registration, query: string | null): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  const candidates = [reg.id, (reg as any)?.partyId, (reg as any)?.divisionId, (reg as any)?.classId];
  return candidates.some((val) => typeof val === "string" && val.toLowerCase().includes(needle));
}

export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const { tenantId, eventId } = event.pathParameters as any;
    if (!tenantId || !eventId) {
      return bad("Missing tenantId or eventId");
    }

    const params = event.queryStringParameters || {};

    const checkedInParsed = parseBoolean(params.checkedIn);
    if (checkedInParsed === null) return bad("Invalid checkedIn value");
    const checkedIn = checkedInParsed ?? false;

    const readyParsed = parseBoolean(params.ready);
    if (readyParsed === null) return bad("Invalid ready value");
    const readyFilter: boolean | null = readyParsed === undefined ? null : readyParsed;

    const blockerCodeRaw = params.blockerCode?.trim();
    const blockerCodes = blockerCodeRaw
      ? new Set(blockerCodeRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))
      : new Set<string>();

    const statusRaw = params.status?.trim();
    if (statusRaw && !STATUS_ALLOWLIST.has(statusRaw)) return bad("Invalid status value");
    const statusFilter = statusRaw || null;

    const qRaw = params.q?.trim();
    const q = qRaw && qRaw.length > 0 ? qRaw : null;

    const rawLimit = params.limit ? parseInt(params.limit, 10) : DEFAULT_LIMIT;
    const limit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT));
    let nextCursor: string | null = params.next || null;

    const collected: Registration[] = [];
    let finalNext: string | null = nextCursor;
    let pageCount = 0;

    while (pageCount < MAX_BACKEND_PAGES && collected.length < limit) {
      const page = await listRegistrationsByEventId({
        tenantId,
        eventId,
        limit,
        next: nextCursor || undefined,
        scanIndexForward: true,
        q,
      });

      const regs = page.items as Registration[];

      for (const reg of regs) {
        if (collected.length >= limit) break;

        const cis = (reg as any).checkInStatus as CheckInStatus | undefined;

        if (!matchesCheckedIn(reg, checkedIn)) continue;
        if (!matchesReadyFilter(cis, readyFilter)) continue;
        if (!matchesBlockerFilter(cis, blockerCodes, readyFilter)) continue;
        if (!matchesStatus(reg, statusFilter)) continue;
        if (!matchesQuery(reg, q)) continue;

        collected.push(reg);
      }

      finalNext = page.next || null;
      nextCursor = finalNext;

      if (!finalNext) break;
      pageCount += 1;
    }

    const response: CheckInWorklistPage = {
      eventId,
      checkedIn,
      ready: readyFilter ?? null,
      blockerCode: blockerCodeRaw ?? null,
      items: collected,
      next: finalNext,
    };

    return ok(response);
  } catch (e: any) {
    return error(e);
  }
}
