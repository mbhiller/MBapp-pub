// apps/mobile/src/features/resources/actions.ts
import { updateObject } from "../../api/client";
import type { components } from "../../api/generated-types";

export type Resource = components["schemas"]["Resource"];
export const newIdempotencyKey = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export async function setStatus(id: string, status: Resource["status"]) {
  return updateObject("resource", id, { status } as Partial<Resource>, { idempotencyKey: newIdempotencyKey() });
}