export type WithKey<T = any> = T & { _key: string };

export function makeKey(id?: string) {
  return id && typeof id === "string"
    ? `ID_${id}`.replace(/^ID_ID_/, "ID_")
    : `CID_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
