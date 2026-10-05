// Edge Function calls. The user's JWT is attached automatically; functions
// re-verify identity and authorization server-side.
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { isConfigured, supabase } from '@/lib/supabase';
import { type AppError, fail } from './errors';

export type EdgeFunctionName =
  | 'admin-create-user' | 'admin-update-user' | 'admin-create-organization' | 'send-invitation' | 'accept-invitation'
  | 'schedule-notification' | 'dispatch-notification' | 'generate-report' | 'ai-program-analysis' | 'ai-assessment-interpretation'
  | 'ai-impact-analysis' | 'expert-matching' | 'import-external-assessment' | 'evidence-verification' | 'calendar-sync' | 'program-health-check';

export async function callFunction<T>(name: EdgeFunctionName, body: Record<string, unknown>): Promise<T> {
  if (!isConfigured) fail({ code: 'not_configured' });
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      let payload: { error?: AppError } | null = null;
      try { payload = await error.context.json(); } catch { /* not json */ }
      if (payload?.error) fail(payload.error);
      if (error.context.status === 404) fail({ code: 'function_unavailable', message: `${name} not deployed` });
      fail({ code: String(error.context.status), message: `HTTP ${error.context.status}` });
    }
    if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) fail({ code: 'function_unavailable', message: error.message });
    fail(error);
  }
  const res = data as { ok?: boolean; data?: T; error?: AppError };
  if (res && res.ok === false && res.error) fail(res.error);
  return (res && 'data' in res ? res.data : res) as T;
}
