// Small, dependency-free input validators. A validator is a function
// (value, path) => typed value that throws AppError('invalid_input', {field}).
import { AppError } from './http.ts';

export type Validator<T> = (value: unknown, path: string) => T;
export type Infer<V> = V extends Validator<infer T> ? T : never;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function bad(path: string, reason: string): never {
  throw new AppError('invalid_input', { field: path || undefined, detail: { field: path, reason } });
}

export function uuid(): Validator<string> {
  return (v, p) => {
    if (typeof v !== 'string' || !UUID_RE.test(v)) bad(p, 'must be a UUID');
    return v.toLowerCase();
  };
}

export function email(): Validator<string> {
  return (v, p) => {
    if (typeof v !== 'string') bad(p, 'must be an email');
    const s = v.trim().toLowerCase();
    if (s.length > 254 || !EMAIL_RE.test(s)) bad(p, 'must be a valid email');
    return s;
  };
}

export function string(opts: { min?: number; max?: number; trim?: boolean; pattern?: RegExp } = {}): Validator<string> {
  const { min = 0, max = 10_000, trim = true, pattern } = opts;
  return (v, p) => {
    if (typeof v !== 'string') bad(p, 'must be a string');
    const s = trim ? v.trim() : v;
    if (s.length < min) bad(p, min === 1 ? 'is required' : `must be at least ${min} characters`);
    if (s.length > max) bad(p, `must be at most ${max} characters`);
    if (pattern && !pattern.test(s)) bad(p, 'has an invalid format');
    return s;
  };
}

export function date(): Validator<string> {
  return (v, p) => {
    if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) bad(p, 'must be a date (YYYY-MM-DD)');
    return v;
  };
}

export function enumOf<const T extends readonly string[]>(values: T): Validator<T[number]> {
  return (v, p) => {
    if (typeof v !== 'string' || !values.includes(v)) bad(p, `must be one of: ${values.join(', ')}`);
    return v as T[number];
  };
}

export function int(opts: { min?: number; max?: number } = {}): Validator<number> {
  return (v, p) => {
    if (typeof v !== 'number' || !Number.isInteger(v)) bad(p, 'must be an integer');
    if (opts.min !== undefined && v < opts.min) bad(p, `must be ≥ ${opts.min}`);
    if (opts.max !== undefined && v > opts.max) bad(p, `must be ≤ ${opts.max}`);
    return v;
  };
}

export function number(opts: { min?: number; max?: number } = {}): Validator<number> {
  return (v, p) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) bad(p, 'must be a number');
    if (opts.min !== undefined && v < opts.min) bad(p, `must be ≥ ${opts.min}`);
    if (opts.max !== undefined && v > opts.max) bad(p, `must be ≤ ${opts.max}`);
    return v;
  };
}

export function bool(): Validator<boolean> {
  return (v, p) => {
    if (typeof v !== 'boolean') bad(p, 'must be a boolean');
    return v;
  };
}

/** undefined and null are both accepted and normalised to undefined. */
export function optional<T>(inner: Validator<T>): Validator<T | undefined> {
  return (v, p) => (v === undefined || v === null ? undefined : inner(v, p));
}

export function withDefault<T>(inner: Validator<T>, fallback: T): Validator<T> {
  return (v, p) => (v === undefined || v === null ? fallback : inner(v, p));
}

export function array<T>(inner: Validator<T>, opts: { min?: number; max?: number; unique?: boolean } = {}): Validator<T[]> {
  const { min = 0, max = 1000, unique = false } = opts;
  return (v, p) => {
    if (!Array.isArray(v)) bad(p, 'must be an array');
    if (v.length < min) bad(p, `must contain at least ${min} item(s)`);
    if (v.length > max) bad(p, `must contain at most ${max} items`);
    const out = v.map((x, i) => inner(x, `${p}[${i}]`));
    return unique ? [...new Set(out)] : out;
  };
}

export function record<T>(inner: Validator<T>, opts: { maxKeys?: number; key?: Validator<string> } = {}): Validator<Record<string, T>> {
  const { maxKeys = 200, key } = opts;
  return (v, p) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) bad(p, 'must be an object');
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length > maxKeys) bad(p, `must have at most ${maxKeys} keys`);
    const out: Record<string, T> = {};
    for (const [k, val] of entries) {
      const kk = key ? key(k, `${p}.${k}`) : k;
      out[kk] = inner(val, `${p}.${k}`);
    }
    return out;
  };
}

/** Free-form JSON object (size-checked). */
export function jsonObject(maxBytes = 64 * 1024): Validator<Record<string, unknown>> {
  return (v, p) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) bad(p, 'must be an object');
    if (JSON.stringify(v).length > maxBytes) bad(p, 'is too large');
    return v as Record<string, unknown>;
  };
}

type Shape = Record<string, Validator<unknown>>;
type ObjectOf<S extends Shape> = { [K in keyof S]: Infer<S[K]> };

/** Validates known keys; unknown keys are ignored (stripped). */
export function object<S extends Shape>(shape: S): Validator<ObjectOf<S>> {
  return (v, p) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) bad(p, 'must be an object');
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(shape)) {
      out[k] = val(src[k], p ? `${p}.${k}` : k);
    }
    return out as ObjectOf<S>;
  };
}

export function parse<T>(validator: Validator<T>, input: unknown): T {
  return validator(input, '');
}
