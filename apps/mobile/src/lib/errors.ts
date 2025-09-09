// apps/mobile/src/lib/errors.ts
import { toast } from "../ui/Toast";

export function parseApiError(e: any): { message: string; requestId?: string } {
  try {
    const res = e?.response;
    const data = res?.data;
    const message =
      data?.message || data?.error || e?.message || String(e) || "Request failed";
    const requestId =
      res?.headers?.["x-request-id"] ||
      res?.headers?.["X-Request-Id"] ||
      undefined;
    return { message: String(message), requestId };
  } catch {
    const message = e?.message || "Request failed";
    return { message: String(message) };
  }
}

export function toastFromError(
  e: any,
  prefix?: string,
  opts?: { duration?: number }
) {
  const { message, requestId } = parseApiError(e);
  let text = prefix ? `${prefix}: ${message}` : message;
  if (requestId) text += ` (req ${requestId})`;
  toast(text, opts);
}
