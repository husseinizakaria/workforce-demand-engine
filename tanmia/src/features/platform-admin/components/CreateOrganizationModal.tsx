// Create an organization through the admin-create-organization Edge Function
// (seeds roles/modules server-side, optionally invites the first admin).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Building2, CheckCircle2 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { Button, Checkbox, Field, Input, Modal, Notice, Select } from '@/components/ui';
import { callFunction } from '@/services/functions';
import { type AppError, errorOf } from '@/services/errors';
import type { ModuleKey, Organization } from '@/types/db';
import { CopyField, EMAIL_PATTERN, EmailStatusBadge, MODULE_KEYS, useErrText } from './common';

interface CreateOrgResult {
  organization: Organization;
  admin: { user_id: string | null; invitation_link: string | null; email_status: string } | null;
}

const empty = () => ({
  name: '', name_en: '', org_type: '', sector: '', city: '', contact_email: '', default_locale: 'ar',
  modules: Object.fromEntries(MODULE_KEYS.map((m) => [m, true])) as Record<ModuleKey, boolean>,
  withAdmin: true, admin_email: '', admin_name: '',
});

export function CreateOrganizationModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (o: Organization) => void }) {
  const { tr, enumLabel, pick } = useI18n();
  const errText = useErrText();
  const navigate = useNavigate();
  const [v, setV] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [result, setResult] = useState<CreateOrgResult | null>(null);

  useEffect(() => { if (open) { setV(empty()); setErrors({}); setError(null); setResult(null); } }, [open]);
  const set = <K extends keyof ReturnType<typeof empty>>(k: K, val: ReturnType<typeof empty>[K]) => setV((s) => ({ ...s, [k]: val }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!v.name.trim()) e.name = tr('اسم المؤسسة إلزامي', 'Organization name is required');
    if (v.contact_email && !EMAIL_PATTERN.test(v.contact_email.trim())) e.contact_email = tr('بريد غير صالح', 'Invalid email');
    if (v.withAdmin) {
      if (!EMAIL_PATTERN.test(v.admin_email.trim())) e.admin_email = tr('بريد المدير إلزامي وصالح', 'A valid admin email is required');
      if (!v.admin_name.trim()) e.admin_name = tr('اسم المدير إلزامي', 'Admin name is required');
    }
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        name: v.name.trim(), name_en: v.name_en.trim() || undefined, org_type: v.org_type.trim() || undefined, sector: v.sector.trim() || undefined,
        city: v.city.trim() || undefined, contact_email: v.contact_email.trim().toLowerCase() || undefined, default_locale: v.default_locale, modules: v.modules,
      };
      if (v.withAdmin) body.admin = { email: v.admin_email.trim().toLowerCase(), full_name: v.admin_name.trim() };
      const r = await callFunction<CreateOrgResult>('admin-create-organization', body);
      setResult(r);
      onCreated?.(r.organization);
    } catch (e) { setError(errorOf(e)); } finally { setBusy(false); }
  };

  const disabledCount = MODULE_KEYS.filter((m) => !v.modules[m]).length;
  if (result) {
    const o = result.organization;
    return (
      <Modal open={open} onClose={onClose} title={tr('تم إنشاء المؤسسة', 'Organization created')}
        footer={<>
          <Button onClick={onClose}>{tr('إغلاق', 'Close')}</Button>
          <Button variant="primary" icon={<Building2 />} onClick={() => { onClose(); navigate(`/platform/organizations/${o.id}`); }}>{tr('فتح المؤسسة', 'Open organization')}</Button>
        </>}>
        <div className="stack-sm">
          <Notice tone="success" icon={<CheckCircle2 />}>
            <b>{pick(o.name, o.name_en)}</b> <span className="mono">{o.code}</span> — {tr('أُنشئت مع الأدوار الافتراضية من قوالب المنصة وتفعيل الوحدات المحددة.', 'created with default roles copied from platform templates and the selected modules.')}
          </Notice>
          {result.admin ? (
            <div className="stack-sm">
              <div className="row wrap"><b>{tr('المدير الأول', 'First admin')}</b><EmailStatusBadge status={result.admin.email_status} /></div>
              {result.admin.invitation_link ? (
                <>
                  <CopyField value={result.admin.invitation_link} label={tr('رابط الدعوة (يظهر مرة واحدة فقط — لا يُخزن الرمز إلا مُجزّأ)', 'Invitation link (shown once — only a hash of the token is stored)')} />
                  <p className="tiny muted">{tr('يقبل المدير الدعوة بتسجيل الدخول بنفس البريد الإلكتروني.', 'The admin accepts by signing in with the same email address.')}</p>
                </>
              ) : result.admin.user_id ? (
                <p className="small">{tr('المستخدم موجود مسبقًا وأُضيف مباشرة كعضو بدور مدير المؤسسة.', 'The user already existed and was added directly as a member with the organization admin role.')}</p>
              ) : null}
            </div>
          ) : (
            <Notice tone="warning">{tr('لم يُحدد مدير للمؤسسة. ادعُ مديرًا من صفحة المؤسسة حتى يتمكن أحد من إدارتها.', 'No admin was specified. Invite one from the organization page so someone can manage it.')}</Notice>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} size="wide" title={tr('إنشاء مؤسسة', 'Create organization')}
      footer={<><Button onClick={onClose}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={submit}>{tr('إنشاء', 'Create')}</Button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {error && <Notice tone="danger">{errText(error)}{error.code === 'function_unavailable' && <> — {tr('انشر الدالة admin-create-organization ثم أعد المحاولة.', 'Deploy the admin-create-organization function and retry.')}</>}</Notice>}
        <div className="form-grid">
          <Field label={tr('الاسم (عربي)', 'Name (Arabic)')} required error={errors.name}><Input value={v.name} onChange={(e) => set('name', e.target.value)} invalid={!!errors.name} /></Field>
          <Field label={tr('الاسم (إنجليزي)', 'Name (English)')}><Input dir="ltr" value={v.name_en} onChange={(e) => set('name_en', e.target.value)} /></Field>
          <Field label={tr('نوع الجهة', 'Organization type')} hint={tr('مثال: جمعية أهلية، جهة حكومية، شركة', 'e.g. non-profit, government, company')}><Input value={v.org_type} onChange={(e) => set('org_type', e.target.value)} /></Field>
          <Field label={tr('القطاع', 'Sector')}><Input value={v.sector} onChange={(e) => set('sector', e.target.value)} /></Field>
          <Field label={tr('المدينة', 'City')}><Input value={v.city} onChange={(e) => set('city', e.target.value)} /></Field>
          <Field label={tr('بريد التواصل', 'Contact email')} error={errors.contact_email}><Input type="email" dir="ltr" value={v.contact_email} onChange={(e) => set('contact_email', e.target.value)} invalid={!!errors.contact_email} /></Field>
          <Field label={tr('اللغة الافتراضية', 'Default language')}>
            <Select value={v.default_locale} onChange={(e) => set('default_locale', e.target.value)} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
          </Field>
        </div>
        <div className="stack-sm">
          <div className="row between"><b className="small">{tr('الوحدات المفعلة', 'Enabled modules')}</b>
            <span className="tiny muted">{disabledCount ? tr(`${disabledCount} وحدات معطلة`, `${disabledCount} modules disabled`) : tr('جميع الوحدات مفعلة', 'All modules enabled')}</span></div>
          <div className="grid g4" style={{ gap: 6 }}>
            {MODULE_KEYS.map((m) => <Checkbox key={m} label={enumLabel('module', m)} checked={v.modules[m]} onChange={(c) => set('modules', { ...v.modules, [m]: c })} />)}
          </div>
          <p className="tiny muted">{tr('وحدة المستخدمين مفعلة دائمًا. يمكن تغيير الوحدات لاحقًا من صفحة المؤسسة.', 'The users module is always enabled. Modules can be changed later from the organization page.')}</p>
        </div>
        <div className="stack-sm">
          <Checkbox label={tr('دعوة مدير المؤسسة الأول الآن (موصى به)', 'Invite the first organization admin now (recommended)')} checked={v.withAdmin} onChange={(c) => set('withAdmin', c)} />
          {v.withAdmin && (
            <div className="form-grid">
              <Field label={tr('بريد المدير', 'Admin email')} required error={errors.admin_email}><Input type="email" dir="ltr" value={v.admin_email} onChange={(e) => set('admin_email', e.target.value)} invalid={!!errors.admin_email} /></Field>
              <Field label={tr('اسم المدير', 'Admin full name')} required error={errors.admin_name}><Input value={v.admin_name} onChange={(e) => set('admin_name', e.target.value)} invalid={!!errors.admin_name} /></Field>
            </div>
          )}
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
