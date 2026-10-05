// HTTP plumbing shared by every Edge Function: CORS, the JSON envelope
// ({ ok: true, data } | { ok: false, error }), typed errors and a serve()
// wrapper that turns thrown errors into controlled responses.

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/** Bilingual messages for every error code an Edge Function can return. */
const MESSAGES: Record<string, [number, string, string]> = {
  unauthorized: [401, 'يلزم تسجيل الدخول.', 'Authentication required.'],
  forbidden: [403, 'ليست لديك صلاحية لتنفيذ هذا الإجراء.', 'You do not have permission to perform this action.'],
  module_disabled: [403, 'هذه الوحدة غير مفعلة لهذه المؤسسة.', 'This module is disabled for the organization.'],
  not_found: [404, 'السجل غير موجود أو لا يتبع هذه المؤسسة.', 'Record not found in this organization.'],
  invalid_input: [400, 'البيانات المدخلة غير صحيحة.', 'Invalid input.'],
  invalid_json: [400, 'جسم الطلب ليس JSON صالحًا.', 'Request body is not valid JSON.'],
  method_not_allowed: [405, 'طريقة الطلب غير مدعومة.', 'HTTP method not allowed.'],
  conflict: [409, 'تعارض مع بيانات موجودة.', 'Conflicts with existing data.'],
  program_required: [400, 'يجب ربط التقرير ببرنامج.', 'The report must be linked to a program.'],
  llm_not_configured: [412, 'خدمة الذكاء الاصطناعي غير مهيأة.', 'The AI service is not configured.'],
  llm_failed: [500, 'تعذر إكمال طلب الذكاء الاصطناعي.', 'The AI request could not be completed.'],
  invitation_invalid: [404, 'رابط الدعوة غير صالح.', 'The invitation link is invalid.'],
  invitation_expired: [409, 'انتهت صلاحية الدعوة.', 'The invitation has expired.'],
  invitation_not_pending: [409, 'الدعوة لم تعد قابلة للاستخدام.', 'The invitation is no longer pending.'],
  email_mismatch: [403, 'البريد الإلكتروني للحساب لا يطابق الدعوة.', 'Your account email does not match the invitation.'],
  organization_inactive: [409, 'المؤسسة غير نشطة.', 'The organization is not active.'],
  already_linked: [409, 'السجل مرتبط بمستخدم آخر.', 'The record is already linked to another user.'],
  cannot_modify_self: [409, 'لا يمكنك تنفيذ هذا الإجراء على حسابك.', 'You cannot perform this action on your own account.'],
  self_verification_not_allowed: [403, 'لا يمكن التحقق من دليل رفعته بنفسك.', 'You cannot verify evidence you uploaded.'],
  already_exists: [409, 'السجل موجود مسبقًا.', 'The record already exists.'],
  file_not_found: [404, 'الملف غير موجود.', 'File not found.'],
  too_large: [400, 'حجم البيانات يتجاوز الحد المسموح.', 'The payload exceeds the allowed size.'],
  internal: [500, 'حدث خطأ غير متوقع.', 'An unexpected error occurred.'],
};

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly message_ar: string;
  readonly message_en: string;
  readonly detail?: unknown;
  readonly field?: string;

  constructor(code: string, opts: { status?: number; message_ar?: string; message_en?: string; detail?: unknown; field?: string } = {}) {
    const base = MESSAGES[code] ?? MESSAGES.internal;
    super(opts.message_en ?? base[2]);
    this.code = code;
    this.status = opts.status ?? base[0];
    this.message_ar = opts.message_ar ?? base[1];
    this.message_en = opts.message_en ?? base[2];
    this.detail = opts.detail;
    this.field = opts.field;
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = { code: this.code, message_ar: this.message_ar, message_en: this.message_en };
    if (this.field !== undefined) out.field = this.field;
    if (this.detail !== undefined) out.detail = this.detail;
    return out;
  }
}

export function fail(code: string, opts: ConstructorParameters<typeof AppError>[1] = {}): never {
  throw new AppError(code, opts);
}

/** Maps a PostgREST / Postgres error to an AppError (never leaks internals). */
export function dbError(err: { code?: string; message?: string; details?: string } | null | undefined, context = 'db'): AppError {
  const code = err?.code ?? '';
  console.error(`[${context}] database error`, code, err?.message);
  switch (code) {
    case '42501': return new AppError('forbidden');
    case '23505': return new AppError('already_exists');
    case '23503': return new AppError('not_found', { detail: { reason: 'reference' } });
    case '23502': case '23514': case '22023': case '22P02': return new AppError('invalid_input', { detail: { reason: err?.message } });
    case 'P0002': case 'PGRST116': return new AppError('not_found');
    default: return new AppError('internal');
  }
}

/** Throws a mapped AppError when a supabase-js result carries an error. */
export function check<T>(res: { data: T; error: { code?: string; message?: string } | null }, context?: string): T {
  if (res.error) throw dbError(res.error, context);
  return res.data;
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

export function ok(data: unknown): Response {
  return json({ ok: true, data });
}

export function errResponse(e: unknown): Response {
  if (e instanceof AppError) return json({ ok: false, error: e.toJSON() }, e.status);
  console.error('[edge] unhandled error', e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : e);
  const err = new AppError('internal');
  return json({ ok: false, error: err.toJSON() }, 500);
}

/** Reads a JSON object body. Empty body → {}. */
export async function readJson(req: Request, maxBytes = 6 * 1024 * 1024): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > maxBytes) fail('too_large');
  if (!text.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { fail('invalid_json'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('invalid_input', { detail: { reason: 'body must be a JSON object' } });
  return parsed as Record<string, unknown>;
}

export type Handler = (req: Request) => Promise<Response | unknown>;

/**
 * Deno.serve wrapper: CORS preflight, method guard, error mapping.
 * A handler returns either a Response (sent as-is) or data (wrapped in { ok: true, data }).
 */
export function serve(handler: Handler, opts: { methods?: string[] } = {}): void {
  const methods = opts.methods ?? ['POST'];
  Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (!methods.includes(req.method)) return errResponse(new AppError('method_not_allowed'));
    try {
      const out = await handler(req);
      return out instanceof Response ? out : ok(out ?? null);
    } catch (e) {
      return errResponse(e);
    }
  });
}
