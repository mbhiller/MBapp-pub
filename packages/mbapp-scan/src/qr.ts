export type MbappQr = {
  t?: string;
  id: string;
  type: string;
  href?: string;
};

/**
 * Accepts a raw string from the camera scan and returns a normalized MBapp QR object,
 * or null if it's not in the expected shape.
 */
export function parseMbappQr(raw: string): MbappQr | null {
  try {
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object") return null;
    if (typeof (j as any).id === "string" && typeof (j as any).type === "string") {
      return {
        t: typeof (j as any).t === "string" ? (j as any).t : undefined,
        id: (j as any).id,
        type: (j as any).type,
        href: typeof (j as any).href === "string" ? (j as any).href : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}
