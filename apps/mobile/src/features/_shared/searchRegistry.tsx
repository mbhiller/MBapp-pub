// Central registry of autocomplete search types per use-case.
const REGISTRY: Record<string, string[]> = {
  // Sales
  salesLine: ["product", "inventory"],
  customer:  ["client", "customer", "vendor", "employee"],

  // You can add these later:
  // purchaseLine: ["product", "inventory"],
  // resourcePick: ["resource", "reservation"],
};

export function getSearchTypes(kind: keyof typeof REGISTRY | string): string[] {
  return REGISTRY[kind] || [];
}
