// src/features/organizations/api.ts
import {
  listObjects,
  getObject,
  createObject,
  updateObject,
  deleteObject,
} from "../../api/client";
import type { components } from "../../api/generated-types";

export type Organization = components["schemas"]["Organization"];
const TYPE = "organization" as const;

type ListParams = {
  limit?: number;
  next?: string;                 // note: no "null" here
  sort?: "asc" | "desc";
  by?: string;
  q?: string;
  filters?: Record<string, any>; // pass-through if your backend supports it
};

function sanitizeParams(params?: ListParams): Record<string, any> | undefined {
  if (!params) return undefined;
  const out: Record<string, any> = { ...params };

  // Strip null/empty values so we don't violate narrower client types
  if (out.next == null) delete out.next;      // removes null/undefined
  if (!out.q) delete out.q;
  if (!out.by) delete out.by;
  if (!out.sort) delete out.sort;
  if (!out.filters) delete out.filters;

  return out;
}

export function listOrganizations(params?: ListParams) {
  return listObjects<Organization>(TYPE, sanitizeParams(params) ?? {});
}

export function getOrganization(id: string) {
  return getObject<Organization>(TYPE, String(id));
}

export function createOrganization(body: Partial<Organization>) {
  return createObject<Organization>(TYPE, {
    type: TYPE,
    ...body,
  } as any);
}

export function updateOrganization(id: string, patch: Partial<Organization>) {
  return updateObject<Organization>(TYPE, String(id), patch as any);
}

export function deleteOrganization(id: string) {
  return deleteObject(TYPE, String(id));
}
