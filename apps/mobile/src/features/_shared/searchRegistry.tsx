export type SearchKey =
  | "salesLine"     // items for SO lines
  | "customer"      // customers
  | "purchaseLine"
  | "vendor";

const registry: Record<SearchKey, string[]> = {
  salesLine: ["product", "inventory"],
  customer: ["employee","vendor","client","organization","contact","person","customer","patient"],
  purchaseLine: ["product","inventory"],
  vendor: ["vendor","organization","supplier","contact","person"],
};

export function getSearchTypes(key: SearchKey) {
  return registry[key] ?? [];
}
