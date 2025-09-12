// apps/mobile/src/lib/errors.ts
import { Alert } from "react-native";

export function toast(message: string) {
  // Minimal UX for now; swap to your toast system later
  Alert.alert("", message);
}

export function getErrorMessage(err: unknown, fallback = "Something went wrong") {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) return String((err as any).message ?? fallback);
  return fallback;
}

export function notifyError(err: unknown, prefix?: string) {
  const msg = getErrorMessage(err);
  toast(prefix ? `${prefix}: ${msg}` : msg);
}
