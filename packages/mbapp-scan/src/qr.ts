export type MbappQr = {
  t?: string;
  id: string;
  type: string;
  href?: string;
};

export type BadgeQr = {
  eventId: string;
  registrationId: string;
  issuanceId?: string;
};

export type TicketQr = {
  kind: "ticket";
  eventId: string;
  registrationId: string;
  ticketId: string;
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

/** Parse badge issuance QR payload: badge|{eventId}|{registrationId}|{issuanceId} */
export function parseBadgeQr(qrText: string): BadgeQr | null {
  if (!qrText || typeof qrText !== "string") return null;
  const parts = qrText.split("|");
  if (parts.length < 4) return null;

  const [prefix, eventId, registrationId, issuanceId] = parts;
  if (prefix !== "badge") return null;
  if (!eventId || !registrationId) return null;

  return {
    eventId,
    registrationId,
    issuanceId: issuanceId || undefined,
  };
}

/** Parse ticket QR payload: ticket|{eventId}|{registrationId}|{ticketId} */
export function parseTicketQr(qrText: string): TicketQr | null {
  if (!qrText || typeof qrText !== "string") return null;
  const trimmed = qrText.trim();
  if (!trimmed.startsWith("ticket|")) return null;

  const parts = trimmed.split("|");
  if (parts.length !== 4) return null;
  const [, eventId, registrationId, ticketId] = parts;
  if (!eventId || !registrationId || !ticketId) return null;

  return {
    kind: "ticket",
    eventId,
    registrationId,
    ticketId,
  };
}
