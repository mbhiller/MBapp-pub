type FriendlyError = { title: string; message: string; hint?: string };

function formatError(err: any): string {
  const parts: string[] = [];
  const status = err?.status ?? err?.body?.status;
  const code = err?.code ?? err?.body?.code ?? err?.details?.code;
  const message = err?.message ?? err?.body?.message ?? err?.details?.message;
  if (status) parts.push(`status ${status}`);
  if (code) parts.push(`code ${code}`);
  if (message) parts.push(String(message));
  return parts.join(" · ") || "Request failed";
}

export function friendlyPurchasingError(err: any): FriendlyError {
  const code = err?.body?.code ?? err?.code ?? err?.details?.code;
  const statusValue = err?.body?.status ?? err?.status;
  const base = formatError(err);

  if (code === "VENDOR_REQUIRED") {
    return {
      title: "Vendor required",
      message: "This purchase order has no vendor set. Set vendorId on the PO (or recreate from suggestion with a vendor) and try again."
    };
  }

  if (code === "VENDOR_ROLE_MISSING") {
    return {
      title: "Party is not a vendor",
      message: "The selected vendor party is missing the 'vendor' role. Add the vendor role to that party and try again."
    };
  }

  if (code === "PO_STATUS_NOT_RECEIVABLE") {
    const statusText = statusValue ? ` in status "${statusValue}"` : "";
    return {
      title: "PO not receivable",
      message: `Purchase order is not receivable${statusText}.`
    };
  }

  if (code === "RECEIVE_EXCEEDS_REMAINING") {
    const remaining = err?.body?.remaining ?? err?.details?.remaining;
    const attempted = err?.body?.attemptedDelta ?? err?.details?.attemptedDelta;
    const extra = [
      remaining != null ? `remaining: ${remaining}` : null,
      attempted != null ? `attempted: ${attempted}` : null
    ].filter(Boolean).join(" · ");
    const message = extra ? `Receive exceeds remaining (${extra}).` : "Receive exceeds remaining.";
    return {
      title: "Receive exceeds remaining",
      message
    };
  }

  return { title: "Request failed", message: base };
}
