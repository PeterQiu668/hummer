import { createHash } from 'node:crypto';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalize(value: unknown, insideArray = false): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON only accepts finite numbers');
    return value;
  }
  if (typeof value === 'undefined') {
    if (insideArray) return null;
    throw new TypeError('Canonical JSON does not accept a top-level undefined value');
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item, true));
  if (isPlainObject(value)) {
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (typeof child !== 'undefined') result[key] = normalize(child);
    }
    return result;
  }
  throw new TypeError(`Canonical JSON cannot encode ${Object.prototype.toString.call(value)}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
