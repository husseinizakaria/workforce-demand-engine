// Structured errors suitable for Arabic and English UI.
export interface AppError { code: string; message_ar: string; message_en: string; detail?: string; status?: number }

const KNOWN: Record<string, [string, string]> = {
  '42501': ['ليست لديك صلاحية لتنفيذ هذا الإجراء.', 'You do not have permission to perform this action.'],
  '23505': ['السجل موجود مسبقًا (قيمة مكررة).', 'This record already exists (duplicate value).'],
  '23503': ['السجل المرتبط غير موجود أو لا يمكن حذفه لارتباطه بسجلات أخرى.', 'A related record is missing or this record is still referenced.'],
  '23502': ['حقل إلزامي مفقود.', 'A required field is missing.'],
  '23514': ['القيمة لا تحقق قواعد التحقق.', 'A value does not satisfy validation rules.'],
  '22023': ['قيمة غير صالحة.', 'Invalid value.'],
  '22P02': ['صيغة قيمة غير صحيحة.', 'Invalid value format.'],
  PGRST116: ['السجل غير موجود أو غير مصرح بالوصول إليه.', 'Record not found or not accessible.'],
  PGRST301: ['انتهت الجلسة، يرجى تسجيل الدخول مجددًا.', 'Session expired, please sign in again.'],
  invalid_credentials: ['البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'Invalid email or password.'],
  email_not_confirmed: ['لم يتم تأكيد البريد الإلكتروني بعد.', 'Email address not confirmed yet.'],
  over_request_rate_limit: ['محاولات كثيرة، حاول لاحقًا.', 'Too many attempts, try again later.'],
  network: ['تعذر الاتصال بالخادم. تحقق من الاتصال.', 'Could not reach the server. Check your connection.'],
  not_configured: ['المنصة غير مهيأة: متغيرات Supabase مفقودة في هذا الإصدار.', 'Platform not configured: Supabase variables are missing in this build.'],
  function_unavailable: ['الخدمة الخلفية غير منشورة أو غير متاحة حاليًا.', 'The backend service is not deployed or currently unavailable.'],
};

export function toAppError(e: unknown): AppError {
  if (e && typeof e === 'object' && 'message_ar' in e) return e as AppError;
  const any = e as { code?: string; message?: string; details?: string; hint?: string; status?: number; name?: string } | null;
  const code = any?.code ?? (any?.name === 'TypeError' && /fetch/i.test(any?.message ?? '') ? 'network' : 'unknown');
  const msg = any?.message ?? String(e);
  if (KNOWN[code]) return { code, message_ar: KNOWN[code][0], message_en: KNOWN[code][1], detail: msg, status: any?.status };
  if (/Invalid login credentials/i.test(msg)) return { code: 'invalid_credentials', message_ar: KNOWN.invalid_credentials[0], message_en: KNOWN.invalid_credentials[1] };
  if (/Failed to fetch|NetworkError/i.test(msg)) return { code: 'network', message_ar: KNOWN.network[0], message_en: KNOWN.network[1], detail: msg };
  // Database exceptions raised by TANMIA functions are already human-readable.
  return { code, message_ar: msg, message_en: msg, detail: any?.details ?? any?.hint, status: any?.status };
}

export class AppErrorException extends Error {
  constructor(public readonly appError: AppError) { super(appError.message_en); }
}
export function fail(e: unknown): never { throw new AppErrorException(toAppError(e)); }
export function errorOf(e: unknown): AppError { return e instanceof AppErrorException ? e.appError : toAppError(e); }
