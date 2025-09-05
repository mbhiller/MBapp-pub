import { ok } from "../common/responses";

export const handler = async () => {
  // Return a simple list for now; expand later
  return ok([{ id: "DemoTenant", name: "Demo Tenant" }]);
};
