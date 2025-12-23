export type SearchKey =
  | "salesLine"     // items for SO lines
  | "customer"      // customers
  | "purchaseLine"
  | "vendor";

const registry: Record<SearchKey, string[]> = {
  salesLine: ["product", "inventory"],
  customer: ["employee","vendor","client","organization","contact","person","customer","patient"],
  purchaseLine: ["product","inventory"],
  // Use unified party type for vendor search; backend supports party search
  vendor: ["party"],
};

export function getSearchTypes(key: SearchKey) {
  return registry[key] ?? [];
}
