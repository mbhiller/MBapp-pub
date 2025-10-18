export const ACTIONS = new Set(["receive","reserve","commit","fulfill","adjust","release"] as const);
export type Action = typeof ACTIONS extends Set<infer T> ? T : never;

export function assertAction(value: unknown): asserts value is Action {
  const a = String(value ?? "").toLowerCase();
  if (!ACTIONS.has(a as Action)) throw new Error("Invalid or missing action");
}
