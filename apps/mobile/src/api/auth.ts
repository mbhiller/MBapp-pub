// apps/mobile/src/api/auth.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearBearerToken, setTenantId } from "./client";
import { queryClient } from "../features/_shared/queryClient"; // wherever you create it

export async function devSignOut() {
  await AsyncStorage.multiRemove(["mbapp.dev.token", "mbapp.dev.tenant"]);
  clearBearerToken();
  // optional: reset to your default dev tenant, or clear entirely
  setTenantId("DemoTenant"); // or setTenantId("");
  // optional: clear react-query cache
  try { queryClient.clear(); } catch {}
}
