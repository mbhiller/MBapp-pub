import type { WithKey } from "./keys";

export function toPatchLines<T extends { id?: string; itemId?: string; classId?: string; qty: number; note?: string }>(
  lines: Array<WithKey<T>>
) {
  return lines.map((l) => {
    const cleanId =
      typeof l.id === "string" && !/^TMP_|^CID_/i.test(l.id) ? l.id : undefined;
    const itemOrClass = (l as any).itemId ?? (l as any).classId;
    return {
      id: cleanId,
      itemId: itemOrClass,
      qty: Number((l as any).qty) || 1,
      note: (l as any).note,
    };
  });
}
