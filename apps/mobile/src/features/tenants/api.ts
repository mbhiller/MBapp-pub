// src/features/tenants/api.ts
import { http } from "../../lib/http";

export async function listTenants() {
  const res = await http().get("/tenants");
  // TEMP: log first 1k chars to verify payload
  try { console.log("TENANTS raw:", JSON.stringify(res.data).slice(0, 1000)); } catch {}
  return res.data;
}
