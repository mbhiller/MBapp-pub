import type { components } from "../generated/openapi-types";

export type CheckInStatus = components["schemas"]["CheckInStatus"];
export type CheckInBlocker = components["schemas"]["CheckInBlocker"];
export type CheckInAction = components["schemas"]["CheckInAction"];
export type Registration = components["schemas"]["Registration"];
export type ReservationHold = components["schemas"]["ReservationHold"];

export type ComputeArgs = {
  tenantId?: string;
  registration: Registration;
  holds: ReservationHold[];
};

const ACTIVE_STATES = new Set<string>(["held", "confirmed"]);

export function buildCheckInBlocker(
  code: CheckInBlocker["code"],
  message: string,
  action?: CheckInAction | null
): CheckInBlocker {
  return {
    code,
    message,
    ...(action ? { action } : {}),
  } as CheckInBlocker;
}

export function computeCheckInStatus({ tenantId, registration, holds }: ComputeArgs): CheckInStatus {
  void tenantId; // reserved for future use/hook context

  const blockers: CheckInBlocker[] = [];
  const now = new Date().toISOString();

  const status = String(registration.status || "");
  const paymentStatus = String(registration.paymentStatus || "");
  const stallQty = Number(registration.stallQty || 0);
  const rvQty = Number(registration.rvQty || 0);

  // 1) Cancelled — terminal
  if (status === "cancelled") {
    blockers.push(buildCheckInBlocker("cancelled", "Registration is cancelled"));
    return {
      ready: false,
      blockers,
      lastEvaluatedAt: now,
      version: registration.checkInStatus?.version ?? null,
    };
  }

  // Helper to count assigned holds by type
  function countAssigned(type: ReservationHold["itemType"]): number {
    return holds.filter((h) => String(h.itemType) === type && !!h.resourceId && ACTIVE_STATES.has(String(h.state))).length;
  }

  // 2) Payment
  if (paymentStatus !== "paid") {
    if (paymentStatus === "failed") {
      blockers.push(
        buildCheckInBlocker("payment_failed", "Payment failed", {
          type: "view_payment",
          label: "Retry Payment",
          target: String((registration as any)?.id || ""),
        })
      );
    } else {
      blockers.push(
        buildCheckInBlocker("payment_unpaid", "Payment required", {
          type: "view_payment",
          label: "View Payment",
          target: String((registration as any)?.id || ""),
        })
      );
    }
  }

  // 3) Stalls assignment
  if (stallQty > 0) {
    const assigned = countAssigned("stall");
    if (assigned < stallQty) {
      blockers.push(
        buildCheckInBlocker("stalls_unassigned", `Stalls unassigned (${assigned}/${stallQty})`, {
          type: "assign_stalls",
          label: "Assign Stalls",
          target: String((registration as any)?.id || ""),
        })
      );
    }
  }

  // 4) RV assignment
  if (rvQty > 0) {
    const assigned = countAssigned("rv");
    if (assigned < rvQty) {
      blockers.push(
        buildCheckInBlocker("rv_unassigned", `RV sites unassigned (${assigned}/${rvQty})`, {
          type: "assign_rv",
          label: "Assign RV",
          target: String((registration as any)?.id || ""),
        })
      );
    }
  }

  // 5) Classes assignment
  const totalRequested = Array.isArray(registration.lines)
    ? registration.lines.reduce((sum, line) => sum + Number(line?.qty || 0), 0)
    : 0;
  if (totalRequested > 0) {
    const assigned = countAssigned("class_entry");
    if (assigned < totalRequested) {
      blockers.push(
        buildCheckInBlocker("classes_unassigned", `Class entries unassigned (${assigned}/${totalRequested})`, {
          type: "assign_classes",
          label: "Assign Classes",
          target: String((registration as any)?.id || ""),
        })
      );
    }
  }

  const ready = blockers.length === 0;
  return {
    ready,
    blockers,
    lastEvaluatedAt: now,
    version: registration.checkInStatus?.version ?? null,
  };
}
