// apps/mobile/src/lib/qr.ts
export type MbappQr = {
  t?: string;
  id: string;
  type: string;
  href?: string; // canonical path hint, not required
};

/**
 * Accepts a raw string from the camera scan and returns a normalized MBapp QR object,
 * or null if it's not in the expected shape.
 */
export function parseMbappQr(raw: string): MbappQr | null {
  try {
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object") return null;
    if (typeof j.id === "string" && typeof j.type === "string") {
      return {
        t: typeof j.t === "string" ? j.t : undefined,
        id: j.id,
        type: j.type,
        href: typeof j.href === "string" ? j.href : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}
