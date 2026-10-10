import { createHash } from "node:crypto";

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function objectTag(value: object): string {
  return Object.prototype.toString.call(value);
}

export function canonicalize(
  value: unknown,
  seen = new WeakSet<object>(),
): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "[NaN]";
    if (value === Infinity) return "[Infinity]";
    if (value === -Infinity) return "[-Infinity]";
    return value;
  }
  if (typeof value === "bigint") return value.toString() + "n";
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "function") return "[function]";
  if (typeof value === "symbol") return String(value);
  if (typeof value !== "object") return String(value);

  if (seen.has(value)) return "[circular]";
  seen.add(value);
  try {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Set) {
      return [...value].map((item) => canonicalize(item, seen)).sort(compareCanonical);
    }
    if (value instanceof Map) {
      const entries = [...value.entries()]
        .map(([key, item]) => [String(key), canonicalize(item, seen)] as const)
        .sort(([left], [right]) => left.localeCompare(right));
      return Object.fromEntries(entries);
    }
    if (Array.isArray(value)) {
      return value.map((item) => canonicalize(item, seen));
    }

    const record = value as Record<string, unknown>;
    const out: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (typeof item === "function" || typeof item === "symbol") continue;
      out[key] = canonicalize(item, seen);
    }
    if (Object.keys(out).length === 0 && objectTag(value) !== "[object Object]") {
      return objectTag(value);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

function compareCanonical(left: CanonicalValue, right: CanonicalValue): number {
  return stableStringify(left).localeCompare(stableStringify(right));
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: unknown): string {
  return "sha256:" + createHash("sha256").update(stableStringify(value)).digest("hex");
}

export interface ValueDifference {
  readonly path: string;
  readonly expected: CanonicalValue;
  readonly actual: CanonicalValue;
}

export function differences(
  expected: unknown,
  actual: unknown,
  limit = 32,
): ValueDifference[] {
  const left = canonicalize(expected);
  const right = canonicalize(actual);
  const out: ValueDifference[] = [];

  const walk = (a: CanonicalValue, b: CanonicalValue, path: string): void => {
    if (out.length >= limit) return;
    if (stableStringify(a) === stableStringify(b)) return;

    const aArray = Array.isArray(a);
    const bArray = Array.isArray(b);
    if (aArray || bArray) {
      if (!(aArray && bArray)) {
        out.push({ path, expected: a, actual: b });
        return;
      }
      const max = Math.max(a.length, b.length);
      for (let index = 0; index < max; index++) {
        walk(
          index < a.length ? a[index]! : "[missing]",
          index < b.length ? b[index]! : "[missing]",
          path + "[" + index + "]",
        );
      }
      return;
    }

    const aObject = typeof a === "object" && a !== null;
    const bObject = typeof b === "object" && b !== null;
    if (aObject || bObject) {
      if (!(aObject && bObject)) {
        out.push({ path, expected: a, actual: b });
        return;
      }
      const leftRecord = a as Record<string, CanonicalValue>;
      const rightRecord = b as Record<string, CanonicalValue>;
      const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
      for (const key of keys) {
        walk(
          key in leftRecord ? leftRecord[key]! : "[missing]",
          key in rightRecord ? rightRecord[key]! : "[missing]",
          path ? path + "." + key : key,
        );
      }
      return;
    }

    out.push({ path, expected: a, actual: b });
  };

  walk(left, right, "$");
  return out;
}
