/**
 * Deterministic JSON serialization for Veye artifacts.
 *
 * Keys are sorted alphabetically at every level so that diffs are stable
 * across runs (the only thing that changes between compute runs is real
 * data, not key order). Output ends with a single trailing newline so it
 * is both git-friendly and POSIX-friendly.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function sortObject(value: Json): Json {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value !== null && typeof value === 'object') {
    const sortedKeys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    const out: Record<string, Json> = {};
    for (const key of sortedKeys) {
      const v = value[key];
      if (v !== undefined) {
        out[key] = sortObject(v);
      }
    }
    return out;
  }
  return value;
}

export function serializeJson(value: unknown): string {
  const sorted = sortObject(value as Json);
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
