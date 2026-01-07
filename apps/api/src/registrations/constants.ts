// apps/api/src/registrations/constants.ts

export const REGISTRATION_STATUS = {
  draft: "draft",
  submitted: "submitted",
  confirmed: "confirmed",
  cancelled: "cancelled",
} as const;

export const REGISTRATION_PAYMENT_STATUS = {
  pending: "pending",
  paid: "paid",
  failed: "failed",
  refunded: "refunded",
} as const;
