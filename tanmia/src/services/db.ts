// Thin, typed data-access layer over supabase-js. All calls run with the
// signed-in user's JWT, so Row Level Security decides what is visible.
import { isConfigured, supabase } from '@/lib/supabase';
import { fail } from './errors';

export type Filter =
  | [column: string, op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'is' | 'like' | 'ilike', value: unknown]
  | [column: string, op: 'in', value: unknown[]]
  | [column: string, op: 'contains', value: unknown[]];

export interface ListOptions {
  select?: string;
  filters?: Filter[];
  order?: { column: string; ascending?: boolean } | { column: string; ascending?: boolean }[];
  page?: number;          // 0-based
  pageSize?: number;      // default 50, max 1000
  search?: { columns: string[]; term: string };
  count?: boolean;
}
export interface Page<T> { rows: T[]; total: number | null }

function client() {
  if (!isConfigured) fail({ code: 'not_configured' });
  return supabase;
}

const escapeLike = (s: string) => s.replace(/[%_,()]/g, ' ').trim();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(q: any, filters: Filter[] = []) {
  for (const [col, op, val] of filters) {
    if (val === undefined) continue;
    if (op === 'in') q = q.in(col, val as unknown[]);
    else if (op === 'contains') q = q.contains(col, val as unknown[]);
    else q = q[op](col, val);
  }
  return q;
}

export async function list<T>(table: string, o: ListOptions = {}): Promise<Page<T>> {
  const pageSize = Math.min(o.pageSize ?? 50, 1000);
  let q = client().from(table).select(o.select ?? '*', o.count ? { count: 'exact' } : undefined);
  q = applyFilters(q, o.filters);
  if (o.search?.term?.trim()) {
    const term = escapeLike(o.search.term);
    if (term) q = q.or(o.search.columns.map((c) => `${c}.ilike.%${term}%`).join(','));
  }
  const orders = Array.isArray(o.order) ? o.order : o.order ? [o.order] : [{ column: 'created_at', ascending: false }];
  for (const ord of orders) q = q.order(ord.column, { ascending: ord.ascending ?? false, nullsFirst: false });
  const from = (o.page ?? 0) * pageSize;
  q = q.range(from, from + pageSize - 1);
  const { data, error, count } = await q;
  if (error) fail(error);
  return { rows: (data ?? []) as T[], total: count ?? null };
}

/** Fetch all rows (paged internally) — for bounded per-program datasets. */
export async function all<T>(table: string, o: Omit<ListOptions, 'page' | 'pageSize' | 'count'> = {}, cap = 10000): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page * 1000 < cap; page++) {
    const { rows } = await list<T>(table, { ...o, page, pageSize: 1000 });
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function get<T>(table: string, id: string, select = '*'): Promise<T> {
  const { data, error } = await client().from(table).select(select).eq('id', id).single();
  if (error) fail(error);
  return data as T;
}

export async function maybe<T>(table: string, filters: Filter[], select = '*'): Promise<T | null> {
  let q = client().from(table).select(select);
  q = applyFilters(q, filters);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) fail(error);
  return (data as T) ?? null;
}

export async function insert<T>(table: string, row: Partial<T> | Record<string, unknown>): Promise<T> {
  const { data, error } = await client().from(table).insert(row as never).select().single();
  if (error) fail(error);
  return data as T;
}

export async function insertMany<T>(table: string, rows: Record<string, unknown>[]): Promise<T[]> {
  if (!rows.length) return [];
  const { data, error } = await client().from(table).insert(rows as never).select();
  if (error) fail(error);
  return (data ?? []) as T[];
}

export async function update<T>(table: string, id: string, patch: Partial<T> | Record<string, unknown>): Promise<T> {
  const { data, error } = await client().from(table).update(patch as never).eq('id', id).select().single();
  if (error) fail(error);
  return data as T;
}

export async function updateWhere(table: string, filters: Filter[], patch: Record<string, unknown>): Promise<number> {
  let q = client().from(table).update(patch as never);
  q = applyFilters(q, filters);
  const { data, error } = await q.select('*');
  if (error) fail(error);
  return (data ?? []).length;
}

export async function upsert<T>(table: string, row: Record<string, unknown>, onConflict: string): Promise<T> {
  const { data, error } = await client().from(table).upsert(row as never, { onConflict }).select().single();
  if (error) fail(error);
  return data as T;
}

export async function remove(table: string, id: string): Promise<void> {
  const { error, count } = await client().from(table).delete({ count: 'exact' }).eq('id', id);
  if (error) fail(error);
  if (count === 0) fail({ code: '42501' });
}

export async function removeWhere(table: string, filters: Filter[]): Promise<void> {
  let q = client().from(table).delete();
  q = applyFilters(q, filters);
  const { error } = await q;
  if (error) fail(error);
}

export async function count(table: string, filters: Filter[] = []): Promise<number> {
  let q = client().from(table).select('*', { count: 'exact', head: true });
  q = applyFilters(q, filters);
  const { count: c, error } = await q;
  if (error) fail(error);
  return c ?? 0;
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client().rpc(fn, args);
  if (error) fail(error);
  return data as T;
}
