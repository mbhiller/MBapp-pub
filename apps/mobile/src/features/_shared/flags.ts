// apps/mobile/src/features/_shared/flags.ts
export const FEATURE_PO_QUICK_RECEIVE = true; // toggle as needed
const RAW_RESERVATIONS = process.env.EXPO_PUBLIC_FEATURE_RESERVATIONS_ENABLED;
export const FEATURE_RESERVATIONS_ENABLED = __DEV__
  ? true
  : RAW_RESERVATIONS?.toLowerCase() === "true" || RAW_RESERVATIONS === "1";

const RAW_REGISTRATIONS = 
  process.env.EXPO_PUBLIC_MBAPP_FEATURE_REGISTRATIONS_ENABLED ??
  process.env.EXPO_PUBLIC_FEATURE_REGISTRATIONS_ENABLED;
export const FEATURE_REGISTRATIONS_ENABLED =
  RAW_REGISTRATIONS?.toLowerCase() === "true" || RAW_REGISTRATIONS === "1";
