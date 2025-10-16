import { run as seedParties } from "./seed-parties.mjs";
import { run as seedAccounts } from "./seed-accounts.mjs";
import { run as seedCatalog }  from "./seed-catalog.mjs";
export async function run() {
  const parties = await seedParties();
  const accounts = await seedAccounts(parties);
  const catalog  = await seedCatalog();
  return { action: "seed:all", ...parties, ...accounts, ...catalog };
}
