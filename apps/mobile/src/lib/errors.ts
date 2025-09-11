import { Alert } from "react-native";
export const toast = (m: string) => Alert.alert(m);
export const toastFromError = (e: any, prefix?: string) =>
  Alert.alert(prefix ?? "Error", (e?.message || String(e)).slice(0, 200));
