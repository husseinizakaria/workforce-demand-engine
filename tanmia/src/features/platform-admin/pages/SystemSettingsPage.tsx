import { Fragment, useEffect, useState } from 'react';
import { CheckSquare, Gauge, RotateCcw, Save, Settings } from 'lucide-react';
import { MEASUREMENT_POINTS } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { AsyncView, Button, Card, CardBody, CardHeader, Field, Input, Notice, PageHeader } from '@/components/ui';
import { validateRecord, normalizeRecord, type FieldSpec } from '@/components/forms/RecordForm';
import { useAsync } from '@/hooks/useAsync';
import { useAction } from '@/hooks/useAction';
import * as db from '@/services/db';
import type { SystemSetting } from '@/types/db';
import { PlatformFields, type PlatformFieldSpec } from '../components/PlatformForm';
import { jsonText } from '../components/common';

const POINTS = ['T1', 'T2', 'T3', 'T4', 'T5'] as const;

async function saveSetting(existing: SystemSetting | undefined, key: string, value: Record<string, unknown>): Promise<SystemSetting> {
  if (existing) return db.update<SystemSetting>('system_settings', existing.id, { setting_value: value });
  return db.insert<SystemSetting>('system_settings', { organization_id: null, setting_key: key, setting_value: value });
}

export default function SystemSettingsPage() {
  const { tr } = useI18n();
  const state = useAsync(() => db.all<SystemSetting>('system_settings', { filters: [['organization_id', 'is', null]], order: { column: 'setting_key', ascending: true } }), []);
  return (
    <div className="stack">
      <PageHeader title={tr('إعدادات النظام', 'System settings')} crumbs={[{ label: tr('إدارة المنصة', 'Platform'), to: '/platform' }, { label: tr('إعدادات النظام', 'System settings') }]}
        subtitle={tr('إعدادات افتراضية على مستوى المنصة. يمكن للمؤسسات تجاوز بعضها من إعداداتها الخاصة.', 'Platform-wide defaults. Organizations can override some of them in their own settings.')} />
      <AsyncView state={state}>
        {(rows) => {
          const get = (k: string) => rows.find((r) => r.setting_key === k);
          const others = rows.filter((r) => !['platform', 'measurement_points'].includes(r.setting_key));
          const onSaved = (s: SystemSetting) => state.setData((all) => [...(all ?? []).filter((x) => x.setting_key !== s.setting_key), s]);
          return (
            <>
              <div className="grid g2" style={{ alignItems: 'start' }}>
                <PlatformSettingsCard row={get('platform')} onSaved={onSaved} />
                <MeasurementPointsCard row={get('measurement_points')} onSaved={onSaved} />
              </div>
              {others.length > 0 && (
                <Card>
                  <CardHeader icon={<Settings />} title={tr('إعدادات أخرى (للقراءة)', 'Other settings (read-only)')} />
                  <CardBody>
                    <dl className="kv">{others.map((o) => <Fragment key={o.id}><dt className="mono">{o.setting_key}</dt><dd className="mono tiny" style={{ whiteSpace: 'pre-wrap' }}>{jsonText(o.setting_value)}</dd></Fragment>)}</dl>
                  </CardBody>
                </Card>
              )}
              <DeploymentChecklist />
            </>
          );
        }}
      </AsyncView>
    </div>
  );
}

function PlatformSettingsCard({ row, onSaved }: { row: SystemSetting | undefined; onSaved: (s: SystemSetting) => void }) {
  const { tr } = useI18n();
  const fields: PlatformFieldSpec[] = [
    { name: 'name_ar', label: ['اسم المنصة (عربي)', 'Platform name (Arabic)'], type: 'text', required: true },
    { name: 'name_en', label: ['اسم المنصة (إنجليزي)', 'Platform name (English)'], type: 'text', required: true },
    { name: 'default_locale', label: ['اللغة الافتراضية', 'Default language'], type: 'select', required: true, options: [{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }] },
    { name: 'timezone', label: ['المنطقة الزمنية', 'Time zone'], type: 'text', required: true, hint: ['صيغة IANA، مثل Asia/Riyadh', 'IANA format, e.g. Asia/Riyadh'],
      validate: (v) => { try { new Intl.DateTimeFormat('en', { timeZone: String(v) }); return null; } catch { return ['منطقة زمنية غير معروفة', 'Unknown time zone']; } } },
    { name: 'invitation_ttl_days', label: ['صلاحية الدعوة (أيام)', 'Invitation validity (days)'], type: 'number', required: true, min: 1, max: 30, step: 1,
      validate: (v) => (Number.isInteger(Number(v)) ? null : ['عدد صحيح فقط', 'Whole number only']), hint: ['القيمة الافتراضية عند دعوة المستخدمين (1–30)', 'Default when inviting users (1–30)'] },
    { name: 'data_residency', label: ['ملاحظة إقامة البيانات', 'Data residency note'], type: 'textarea', hint: ['مثال: SA — منطقة me-central-1، والذكاء الاصطناعي معطل', 'e.g. SA — region me-central-1, AI disabled'] },
  ];
  const init = () => ({ name_ar: '', name_en: '', default_locale: 'ar', timezone: 'Asia/Riyadh', invitation_ttl_days: 7, data_residency: '', ...(row?.setting_value ?? {}) });
  const [values, setValues] = useState<Record<string, unknown>>(init);
  const [errors, setErrors] = useState<Record<string, [string, string]>>({});
  useEffect(() => { setValues(init()); setErrors({}); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);
  const save = useAction(async () => {
    const specs = fields as FieldSpec[];
    const errs = validateRecord(specs, values); setErrors(errs);
    if (Object.keys(errs).length) return;
    onSaved(await saveSetting(row, 'platform', { ...(row?.setting_value ?? {}), ...normalizeRecord(specs, values) }));
  }, { success: ['حُفظت إعدادات المنصة', 'Platform settings saved'] });
  const dirty = JSON.stringify(values) !== JSON.stringify(init());
  return (
    <Card>
      <CardHeader icon={<Settings />} title={tr('المنصة', 'Platform')} actions={<Button size="sm" variant="primary" icon={<Save />} loading={save.busy} disabled={!dirty} onClick={() => void save.run()}>{tr('حفظ', 'Save')}</Button>} />
      <CardBody>
        {!row && <div style={{ marginBottom: 8 }}><Notice tone="warning">{tr('لا يوجد سجل إعدادات للمنصة بعد؛ الحفظ سينشئه.', 'No platform settings record yet; saving will create it.')}</Notice></div>}
        <PlatformFields fields={fields} values={values} errors={errors} onChange={(n, v) => setValues((s) => ({ ...s, [n]: v }))} />
      </CardBody>
    </Card>
  );
}

function MeasurementPointsCard({ row, onSaved }: { row: SystemSetting | undefined; onSaved: (s: SystemSetting) => void }) {
  const { tr, L } = useI18n();
  const defaults = Object.fromEntries(MEASUREMENT_POINTS.filter((m) => m.offsetDays !== null).map((m) => [m.key, String(m.offsetDays)])) as Record<string, string>;
  const init = () => Object.fromEntries(POINTS.map((p) => [p, String((row?.setting_value as Record<string, unknown> | undefined)?.[p] ?? defaults[p])])) as Record<string, string>;
  const [v, setV] = useState<Record<string, string>>(init);
  useEffect(() => { setV(init()); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);

  const problems: { ar: string; en: string }[] = [];
  POINTS.forEach((p, i) => {
    const n = Number(v[p]);
    if (v[p] === '' || !Number.isInteger(n) || n < 0 || n > 1825) problems.push({ ar: `${p}: عدد أيام صحيح بين 0 و1825`, en: `${p}: whole days between 0 and 1825` });
    else if (i > 0 && n <= Number(v[POINTS[i - 1]])) problems.push({ ar: `${p} يجب أن يكون بعد ${POINTS[i - 1]}`, en: `${p} must come after ${POINTS[i - 1]}` });
  });
  const save = useAction(async () => {
    const value: Record<string, unknown> = { ...(row?.setting_value ?? {}), T0: 'baseline' };
    for (const p of POINTS) value[p] = Number(v[p]);
    onSaved(await saveSetting(row, 'measurement_points', value));
  }, { success: ['حُفظت نقاط القياس', 'Measurement points saved'] });
  const dirty = JSON.stringify(v) !== JSON.stringify(init());
  const label = (k: string) => { const m = MEASUREMENT_POINTS.find((x) => x.key === k); return m ? L({ ar: m.ar, en: m.en }) : k; };

  return (
    <Card>
      <CardHeader icon={<Gauge />} title={tr('نقاط القياس (T0–T5)', 'Measurement points (T0–T5)')}
        actions={<>
          <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setV(defaults)}>{tr('القيم المرجعية', 'Reference values')}</Button>
          <Button size="sm" variant="primary" icon={<Save />} loading={save.busy} disabled={!dirty || problems.length > 0} onClick={() => void save.run()}>{tr('حفظ', 'Save')}</Button>
        </>} />
      <CardBody>
        <div className="stack-sm">
          <p className="small muted">{tr('عدد الأيام بعد تاريخ نهاية البرنامج لكل نقطة متابعة. T0 هو خط الأساس قبل البدء دائمًا.', 'Days after the program end date for each follow-up point. T0 is always the baseline before start.')}</p>
          <div className="grid g3">
            <Field label={`T0 · ${label('T0')}`}><Input value={tr('قبل البدء', 'Before start')} disabled /></Field>
            {POINTS.map((p) => (
              <Field key={p} label={`${p} · ${label(p)}`} hint={tr(`المرجع: ${defaults[p]}`, `Reference: ${defaults[p]}`)}>
                <Input type="number" min={0} step={1} dir="ltr" value={v[p]} onChange={(e) => setV({ ...v, [p]: e.target.value })} />
              </Field>
            ))}
          </div>
          {problems.length > 0 && <Notice tone="danger"><ul style={{ margin: 0, paddingInlineStart: 16 }}>{problems.map((p, i) => <li key={i}>{L(p)}</li>)}</ul></Notice>}
          <Notice tone="info">{tr('تغيير الإزاحات يؤثر على مواعيد القياس المقترحة مستقبلًا ولا يغير القياسات المسجلة.', 'Changing offsets affects future suggested measurement dates; recorded measurements are not changed.')}</Notice>
        </div>
      </CardBody>
    </Card>
  );
}

function DeploymentChecklist() {
  const { tr } = useI18n();
  const items: [string, string][] = [
    ['تطبيق جميع ملفات الترحيل بالترتيب (npx supabase db push) ثم بيانات المرجع.', 'All migrations applied in order (npx supabase db push), including reference data.'],
    ['نشر جميع الدوال الخلفية الست عشرة (npx supabase functions deploy) وفحصها من صفحة التكاملات.', 'All sixteen Edge Functions deployed (npx supabase functions deploy) and checked from Integrations.'],
    ['ضبط APP_URL و CRON_SECRET، وأسرار البريد/الرسائل/الذكاء الاصطناعي المطلوبة فقط.', 'APP_URL and CRON_SECRET set, plus only the email/SMS/AI secrets you need.'],
    ['Authentication → URL configuration: عنوان الموقع وروابط /reset-password و /invite/* مطابقة للنطاق.', 'Authentication → URL configuration: Site URL and /reset-password, /invite/* redirects match the domain.'],
    ['جدولة dispatch-notification و program-health-check (انظر التكاملات).', 'dispatch-notification and program-health-check scheduled (see Integrations).'],
    ['تفعيل النسخ الاحتياطي اليومي / الاستعادة لنقطة زمنية (PITR) في Supabase.', 'Daily backups / point-in-time recovery (PITR) enabled in Supabase.'],
    ['نسخة احتياطية خارجية دورية: supabase db dump --data-only ومزامنة حاويات التخزين (evidence, documents, imports).', 'Periodic off-site copy: supabase db dump --data-only plus storage bucket sync (evidence, documents, imports).'],
    ['اختبار استعادة ربع سنوي في مشروع تجريبي ثم تشغيل health_check.sql.', 'Quarterly restore test into a staging project, then run health_check.sql.'],
    ['مالكا منصة على الأقل، وسياسة التسجيل العام محددة (يفضل تعطيلها).', 'At least two platform owners; public sign-up policy decided (preferably disabled).'],
    ['التحقق من أن حزمة الواجهة لا تحتوي إلا المفتاح العام (npm run verify:build).', 'Frontend bundle contains only the public anon key (npm run verify:build).'],
    ['لإقامة البيانات في المملكة: منطقة me-central-1 أو استضافة ذاتية، وإبقاء الذكاء الاصطناعي معطلًا إن لزم.', 'For Saudi data residency: region me-central-1 or self-hosting, and keep AI disabled where required.'],
    ['المراقبة: تقارير Supabase وسجلات الدوال (supabase functions logs) ومراقبة توفر الموقع.', 'Monitoring: Supabase reports, function logs (supabase functions logs) and uptime monitoring.'],
  ];
  return (
    <Card>
      <CardHeader icon={<CheckSquare />} title={tr('قائمة النشر والنسخ الاحتياطي', 'Deployment & backup checklist')} hint={tr('إرشادية — تُنفذ خارج المنصة', 'Guidance — performed outside the app')} />
      <CardBody>
        <ol style={{ margin: 0, paddingInlineStart: 20, display: 'grid', gap: 6 }} className="small">
          {items.map(([ar, en], i) => <li key={i}>{tr(ar, en)}</li>)}
        </ol>
      </CardBody>
    </Card>
  );
}
