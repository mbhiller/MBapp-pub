// apps/mobile/src/features/_shared/flags.ts
export const FEATURE_PO_QUICK_RECEIVE = true; // toggle as needed
const RAW_RESERVATIONS = process.env.EXPO_PUBLIC_FEATURE_RESERVATIONS_ENABLED;
export const FEATURE_RESERVATIONS_ENABLED = __DEV__
  ? true
  : RAW_RESERVATIONS?.toLowerCase() === "true" || RAW_RESERVATIONS === "1";
