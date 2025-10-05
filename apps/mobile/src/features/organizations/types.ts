import type { components } from "../../api/generated-types";

export type Organization = components["schemas"]["Organization"];

export type OrgStatus = "active" | "inactive" | "archived";
export type OrgKind   = "club" | "federation" | "venueOp" | "sponsor";
