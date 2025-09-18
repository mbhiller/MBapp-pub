export type ResourceType = "stall" | "arena" | "rv" | "equipment" | "room";
export type ResourceStatus = "available" | "unavailable" | "maintenance";

export type Resource = {
  id: string;
  type: "resource";
  name?: string;
  resourceType?: ResourceType;
  status?: ResourceStatus;
  location?: string;
  createdAt?: string;
  updatedAt?: string;
};
