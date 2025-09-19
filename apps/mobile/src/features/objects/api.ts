import { listObjects, getObject, createObject, updateObject, type ListPage } from "../../api/client";
import type { AnyObject } from "./types";

export const ObjectsAPI = {
  list: (type: string, opts: { limit?: number; next?: string; [k: string]: any } = {}) =>
    listObjects<AnyObject>(type, opts),
  get: (type: string, id: string) => getObject<AnyObject>(type, id),
  create: (type: string, body: Partial<AnyObject>) => createObject<AnyObject>(type, body),
  update: (type: string, id: string, patch: Partial<AnyObject>) => updateObject<AnyObject>(type, id, patch),
};

export type ObjectsPage = ListPage<AnyObject>;
