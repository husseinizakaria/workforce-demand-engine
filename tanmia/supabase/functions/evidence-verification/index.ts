// evidence-verification
//   verify | reject | needs_info → evidence.verify (uploader may not self-verify)
//   gaps                         → evidence.view (engine evidenceCompleteness)
// The status change runs as the caller (user-scoped client) so the database
// trigger records verified_by = auth.uid() and enforces its own rules too.
import { serve, readJson, fail, check } from '../_shared/http.ts';
import { getCaller, isSuperAdmin, requireOrgRow, requirePermission } from '../_shared/auth.ts';
import { enumOf, object, optional, parse, string, uuid } from '../_shared/validate.ts';
import { audit } from '../_shared/audit.ts';
import { loadProgramBundle } from '../_shared/bundle.ts';
import { enqueue } from '../_shared/notifications.ts';
import { evidenceCompleteness } from '../_shared/engine/index.ts';

const Action = object({ action: enumOf(['verify', 'reject', 'needs_info', 'gaps'] as const) });
const DecideBody = object({ organization_id: uuid(), evidence_id: uuid(), notes: optional(string({ max: 2000 })) });
const GapsBody = object({ organization_id: uuid(), program_id: uuid() });

const STATUS = { verify: 'verified', reject: 'rejected', needs_info: 'needs_info' } as const;

serve(async (req) => {
  const caller = await getCaller(req);
  const raw = await readJson(req);
  const { action } = parse(Action, raw);

  if (action === 'gaps') {
    const b = parse(GapsBody, raw);
    await requirePermission(caller, b.organization_id, 'evidence.view');
    const bundle = await loadProgramBundle(caller.admin, b.organization_id, b.program_id);
    return evidenceCompleteness(bundle);
  }

  const b = parse(DecideBody, raw);
  await requirePermission(caller, b.organization_id, 'evidence.verify');
  if (action !== 'verify' && !b.notes) fail('invalid_input', { field: 'notes', detail: { field: 'notes', reason: 'a note is required when rejecting or requesting information' } });
  const admin = caller.admin;
  const ev = await requireOrgRow<{ id: string; code: string; title: string; uploaded_by: string | null; verification_status: string; program_id: string | null }>(
    admin, 'evidence', b.evidence_id, b.organization_id, 'id, code, title, uploaded_by, verification_status, program_id');
  if (action === 'verify' && ev.uploaded_by === caller.userId && !(await isSuperAdmin(caller))) fail('self_verification_not_allowed');

  const status = STATUS[action];
  const { data, error } = await caller.userClient.from('evidence')
    .update({ verification_status: status, verification_notes: b.notes ?? null })
    .eq('id', ev.id).eq('organization_id', b.organization_id).select('*').maybeSingle();
  if (error) {
    if (error.code === '42501' && /uploaded/i.test(error.message)) fail('self_verification_not_allowed');
    check({ data, error }, 'evidence');
  }
  if (!data) fail('forbidden');

  // Tell the uploader when action is needed on their evidence.
  if ((action === 'reject' || action === 'needs_info') && ev.uploaded_by && ev.uploaded_by !== caller.userId) {
    await enqueue(admin, [{
      organization_id: b.organization_id, user_id: ev.uploaded_by, channel: 'in_app',
      event_type: action === 'reject' ? 'evidence_rejected' : 'evidence_needs_info',
      title: action === 'reject' ? `رُفض الدليل ${ev.code}: ${ev.title}` : `مطلوب معلومات إضافية للدليل ${ev.code}: ${ev.title}`,
      body: [action === 'reject' ? `Evidence ${ev.code} was rejected.` : `More information is requested for evidence ${ev.code}.`, b.notes ?? ''].filter(Boolean).join('\n'),
      link: '/app/evidence', entity_type: 'evidence', entity_id: ev.id, status: 'sent', scheduled_for: new Date().toISOString(), sent_at: new Date().toISOString(),
    }]);
  }

  await audit(admin, {
    organization_id: b.organization_id, actor_user_id: caller.userId, action: `evidence_${status}`, entity_type: 'evidence', entity_id: ev.id,
    summary: `${ev.code} ${ev.title}`, old_data: { verification_status: ev.verification_status }, new_data: { verification_status: status, notes: b.notes ?? null },
  });
  return { evidence: data };
});
