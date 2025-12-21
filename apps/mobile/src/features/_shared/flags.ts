// apps/mobile/src/features/_shared/flags.ts
export const FEATURE_PO_QUICK_RECEIVE = true; // toggle as needed
export const FEATURE_RESERVATIONS_ENABLED =
  process.env.EXPO_PUBLIC_FEATURE_RESERVATIONS_ENABLED?.toLowerCase() === "true" ||
  process.env.EXPO_PUBLIC_FEATURE_RESERVATIONS_ENABLED === "1";
