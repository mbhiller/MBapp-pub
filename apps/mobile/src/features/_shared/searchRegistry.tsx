export type SearchKey =
  | "salesLine"     // items for SO lines
  | "customer"      // customers
  | "purchaseLine"
  | "vendor";

const registry: Record<SearchKey, string[]> = {
  salesLine: ["product", "inventory"],
  customer: ["party:customer"],
  purchaseLine: ["product", "inventory"],
  vendor: ["party:vendor"],
};


// Role-aware search registry for party
export function getSearchTypes(key: SearchKey, role?: string) {
  if ((key === "vendor" || key === "customer") && role) {
    return [`party:${role}`];
  }
  return registry[key] ?? [];
}
