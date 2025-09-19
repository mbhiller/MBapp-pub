import { listObjects, getObject, createObject, updateObject } from "../../api/client";
import type { Registration, RegistrationListOpts } from "./types";

const TYPE = "registration";

export const list = (opts: RegistrationListOpts = {}) =>
  listObjects<Registration>(TYPE, opts); // opts may contain eventId, limit, next, order

export const get = (id: string) =>
  getObject<Registration>(TYPE, id);

export const create = (body: Partial<Registration>) =>
  createObject<Registration>(TYPE, body);

export const update = (id: string, body: Partial<Registration>) =>
  updateObject<Registration>(TYPE, id, body);
