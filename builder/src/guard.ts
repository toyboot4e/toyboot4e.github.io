// Runtime shape checks for JSON crossing a process or file boundary (shard IPC,
// linkcard-cache.json, data attributes), so parsed values are typed by
// validation rather than by assertion.
export type Guard<T> = (v: unknown) => v is T;

export const isString: Guard<string> = (v): v is string => typeof v === "string";
export const isNumber: Guard<number> = (v): v is number => typeof v === "number";
export const isBoolean: Guard<boolean> = (v): v is boolean => typeof v === "boolean";

export const optional =
  <T>(g: Guard<T>): Guard<T | undefined> =>
  (v): v is T | undefined =>
    v === undefined || g(v);

export const nullable =
  <T>(g: Guard<T>): Guard<T | null> =>
  (v): v is T | null =>
    v === null || g(v);

export const literal =
  <const T extends string>(...values: readonly T[]): Guard<T> =>
  (v): v is T =>
    values.some((x) => x === v);

export const arrayOf =
  <T>(g: Guard<T>): Guard<T[]> =>
  (v): v is T[] =>
    Array.isArray(v) && v.every((x) => g(x));

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const recordOf =
  <T>(g: Guard<T>): Guard<Record<string, T>> =>
  (v): v is Record<string, T> =>
    isRecord(v) && Object.values(v).every((x) => g(x));

// One guard per key; an optional key takes an `optional(...)` guard.
export const objectOf =
  <T>(shape: { readonly [K in keyof T]-?: Guard<T[K]> }): Guard<T> =>
  (v): v is T =>
    isRecord(v) && Object.entries<Guard<unknown>>(shape).every(([k, g]) => g(v[k]));

export function parseJson<T>(text: string, guard: Guard<T>, what: string): T {
  const v: unknown = JSON.parse(text);
  if (!guard(v)) {
    throw new Error(`${what}: unexpected JSON shape`);
  }
  return v;
}

export const errorText = (error: unknown, withStack = false): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return withStack ? (error.stack ?? error.message) : error.message;
};
