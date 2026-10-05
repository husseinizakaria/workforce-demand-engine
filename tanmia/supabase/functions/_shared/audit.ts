// Audit trail for privileged changes performed by Edge Functions.
// The service role bypasses auth.uid(), so the actor is recorded explicitly.
import type { Db } from './auth.ts';

export interface AuditEntry {
  organization_id?: string | null;
  actor_user_id?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  summary?: string | null;
  old_data?: unknown;
  new_data?: unknown;
  scope?: 'platform' | 'organization';
}

export async function audit(admin: Db, e: AuditEntry): Promise<void> {
  const row = {
    organization_id: e.organization_id ?? null,
    actor_user_id: e.actor_user_id ?? null,
    scope: e.scope ?? (e.organization_id ? 'organization' : 'platform'),
    action: e.action,
    entity_type: e.entity_type ?? null,
    entity_id: e.entity_id ?? null,
    summary: e.summary ? e.summary.slice(0, 1000) : null,
    old_data: e.old_data ?? null,
    new_data: e.new_data ?? null,
    source: 'edge_function',
  };
  const { error } = await admin.from('audit_log').insert(row);
  // The change itself already happened; a failed audit write is logged loudly
  // instead of turning a successful operation into an error.
  if (error) console.error('[audit] insert failed', error.code, error.message, JSON.stringify({ action: e.action, entity: e.entity_type, id: e.entity_id }));
}
