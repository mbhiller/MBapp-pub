import { makeKey, type WithKey } from "./keys";

export function normalizeLines<T extends { id?: string; itemId?: string; classId?: string; qty?: number }>(
  lines: T[] | undefined | null
): Array<WithKey<Required<T>>> {
  const src = Array.isArray(lines) ? lines : [];
  return src.map((ln) => {
    const qty = typeof (ln as any).qty === "number" && !Number.isNaN((ln as any).qty) ? (ln as any).qty : 1;
    const _key = makeKey((ln as any).id);
    return { ...(ln as any), qty, _key } as WithKey<Required<T>>;
  });
}
