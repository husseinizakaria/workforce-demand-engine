// Shared helpers for the Programs feature (center, wizard and workspace).
import { callFunction, type EdgeFunctionName } from '@/services/functions';
import { errorOf, type AppError } from '@/services/errors';

export type FnResult<T> = { ok: true; data: T } | { ok: false; error: AppError; unavailable: boolean };

/** Calls an Edge Function and returns a tagged result instead of throwing. */
export async function tryFunction<T>(name: EdgeFunctionName, body: Record<string, unknown>): Promise<FnResult<T>> {
  try {
    const data = await callFunction<T>(name, body);
    return { ok: true, data };
  } catch (e) {
    const error = errorOf(e);
    const unavailable = error.code === 'function_unavailable' || error.code === '404' || error.code === 'not_configured';
    return { ok: false, error, unavailable };
  }
}

export function errText(locale: 'ar' | 'en', e: AppError | null | undefined): string {
  if (!e) return '';
  return locale === 'ar' ? e.message_ar : e.message_en;
}

/** Narratives returned by Edge Functions may be a string, an {ar,en} pair or a map of sections. */
export function narrativeLines(n: unknown, locale: 'ar' | 'en'): string[] {
  if (n === null || n === undefined) return [];
  if (typeof n === 'string') return n.trim() ? n.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean) : [];
  if (Array.isArray(n)) return n.flatMap((x) => narrativeLines(x, locale));
  if (typeof n === 'object') {
    const o = n as Record<string, unknown>;
    if (typeof o.ar === 'string' || typeof o.en === 'string') {
      const v = locale === 'ar' ? (o.ar ?? o.en) : (o.en ?? o.ar);
      return narrativeLines(v, locale);
    }
    return Object.values(o).flatMap((x) => narrativeLines(x, locale));
  }
  return [String(n)];
}

export const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const round1 = (x: number | null | undefined): number | null => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
export function pct(part: number, whole: number | null | undefined): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/** Inclusive 'YYYY-MM-DD' comparison helper (null-safe). */
export function dateOrderError(start: unknown, end: unknown): [string, string] | null {
  if (typeof start === 'string' && typeof end === 'string' && start && end && end < start) {
    return ['تاريخ النهاية يجب أن يكون في أو بعد تاريخ البداية', 'End date must be on or after the start date'];
  }
  return null;
}

/** Fire-and-report notification scheduling; never fails the calling save. */
export async function notifySessionEvent(organizationId: string, eventType: 'session_scheduled' | 'session_cancelled', sessionId: string) {
  return tryFunction<{ created: number; skipped: number }>('schedule-notification', {
    organization_id: organizationId, event_type: eventType, entity_type: 'session', entity_id: sessionId,
  });
}

export const ACTIVE_ENROLLMENT = new Set(['active', 'completed', 'graduated']);
export const isActiveEnrollment = (status: string) => !['withdrawn', 'dropped'].includes(status);
