import { useEffect, useState } from 'react';
import { BellRing, Building2, CalendarPlus, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import {
  AsyncView, Badge, Button, Card, CardBody, CardHeader, DataTable, Field, Input, Modal, MultiCheck, Notice, Select, StatusBadge, Textarea,
  useConfirm, useToast, type Column,
} from '@/components/ui';
import { RecordFormModal, type FieldSpec } from '@/components/forms/RecordForm';
import { useAsync } from '@/hooks/useAsync';
import { all, get, insert, remove, update, upsert } from '@/services/db';
import { callFunction } from '@/services/functions';
import { errorOf } from '@/services/errors';
import type { NotificationRule, Organization, SystemSetting } from '@/types/db';
import { ShowOnce, UNAVAILABLE, useErrMsg } from '../shared';

export function SettingsTab() {
  const { can } = useOrg();
  return (
    <div className="stack">
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <OrgProfile />
        <CalendarFeed />
      </div>
      <SystemSettings />
      {can('notifications.view') && <NotificationRules />}
    </div>
  );
}

// ----------------------------------------------------------------------------- Organization profile
function OrgProfile() {
  const { tr } = useI18n();
  const { org, refresh } = useOrg();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const state = useAsync(() => get<Organization>('organizations', org.id), [org.id]);
  const fields: FieldSpec[] = [
    { name: 'name', label: ['الاسم (عربي)', 'Name (Arabic)'], type: 'text', required: true },
    { name: 'name_en', label: ['الاسم (إنجليزي)', 'Name (English)'], type: 'text' },
    { name: 'sector', label: ['القطاع', 'Sector'], type: 'text' },
    { name: 'city', label: ['المدينة', 'City'], type: 'text' },
    { name: 'contact_email', label: ['بريد التواصل', 'Contact email'], type: 'email' },
    { name: 'default_locale', label: ['اللغة الافتراضية', 'Default language'], type: 'select', required: true, options: [{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }] },
  ];
  return (
    <Card>
      <CardHeader title={tr('ملف المؤسسة', 'Organization profile')} icon={<Building2 />} actions={<Button size="sm" icon={<Pencil />} onClick={() => setEditing(true)} disabled={!state.data}>{tr('تعديل', 'Edit')}</Button>} />
      <CardBody>
        <AsyncView state={state}>
          {(o) => (
            <dl className="kv">
              <dt>{tr('الرمز', 'Code')}</dt><dd className="mono">{o.code}</dd>
              <dt>{tr('الاسم', 'Name')}</dt><dd>{o.name}</dd>
              <dt>{tr('الاسم بالإنجليزية', 'English name')}</dt><dd>{o.name_en ?? '—'}</dd>
              <dt>{tr('القطاع', 'Sector')}</dt><dd>{o.sector ?? '—'}</dd>
              <dt>{tr('المدينة', 'City')}</dt><dd>{o.city ?? '—'}</dd>
              <dt>{tr('بريد التواصل', 'Contact email')}</dt><dd className="ltr">{o.contact_email ?? '—'}</dd>
              <dt>{tr('اللغة الافتراضية', 'Default language')}</dt><dd>{o.default_locale === 'ar' ? 'العربية' : 'English'}</dd>
              <dt>{tr('المنطقة الزمنية', 'Time zone')}</dt><dd className="ltr">{o.timezone}</dd>
              <dt>{tr('الحالة', 'Status')}</dt><dd><StatusBadge group="orgStatus" value={o.status} /> <span className="tiny muted">{tr('(يغيّرها مالك المنصة فقط)', '(changed by the platform owner only)')}</span></dd>
            </dl>
          )}
        </AsyncView>
      </CardBody>
      <RecordFormModal open={editing} title={tr('تعديل ملف المؤسسة', 'Edit organization profile')} fields={fields} initial={state.data ? { ...state.data } : {}}
        onClose={() => setEditing(false)} onSubmit={async (v) => { await update('organizations', org.id, v); toast.success(tr('تم الحفظ', 'Saved')); await state.reload(); void refresh(); }} />
    </Card>
  );
}

// ----------------------------------------------------------------------------- Calendar feed
function CalendarFeed() {
  const { tr, locale } = useI18n();
  const { org } = useOrg();
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    setBusy(true); setErr(null);
    try { const r = await callFunction<{ feed_url: string }>('calendar-sync', { action: 'create_feed', organization_id: org.id, scope: 'me' }); setUrl(r.feed_url); }
    catch (e) { const ae = errorOf(e); setErr(UNAVAILABLE.has(ae.code) ? tr('خدمة التقويم غير منشورة؛ لم يُنشأ رابط.', 'The calendar service is not deployed; no feed was created.') : locale === 'ar' ? ae.message_ar : ae.message_en); }
    finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader title={tr('اشتراك التقويم', 'Calendar subscription')} icon={<CalendarPlus />} />
      <CardBody>
        <div className="stack-sm">
          <p className="small muted">{tr('أنشئ رابط ICS خاصًا بك لعرض جلساتك في Outlook أو Google Calendar. الرابط سري ويُعرض مرة واحدة فقط.', 'Create a private ICS link to show your sessions in Outlook or Google Calendar. The link is secret and shown only once.')}</p>
          {err && <Notice tone="warning">{err}</Notice>}
          {url ? <ShowOnce value={url} note={tr('انسخ الرابط الآن؛ لن يظهر مرة أخرى. من يملك الرابط يرى جلساتك.', 'Copy the link now; it will not be shown again. Anyone with the link can see your sessions.')} />
            : <div><Button icon={<CalendarPlus />} loading={busy} onClick={create}>{tr('إنشاء رابط تقويمي', 'Create my calendar feed')}</Button></div>}
        </div>
      </CardBody>
    </Card>
  );
}

// ----------------------------------------------------------------------------- System settings
const WEEKDAYS = ['0', '1', '2', '3', '4', '5', '6'];
function SystemSettings() {
  const { tr, enumLabel, fmtDateTime, enumOptions } = useI18n();
  const { org } = useOrg();
  const toast = useToast(); const confirm = useConfirm(); const errMsg = useErrMsg();
  const state = useAsync(async () => {
    const [own, platform] = await Promise.all([
      all<SystemSetting>('system_settings', { filters: [['organization_id', 'eq', org.id]], order: { column: 'setting_key', ascending: true } }),
      all<SystemSetting>('system_settings', { filters: [['organization_id', 'is', null]], order: { column: 'setting_key', ascending: true } }).catch(() => [] as SystemSetting[]),
    ]);
    return { own, platform };
  }, [org.id]);
  const [threshold, setThreshold] = useState('');
  const [week, setWeek] = useState<string[]>([]);
  const [custom, setCustom] = useState<{ key: string; json: string } | null>(null);
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  useEffect(() => {
    const own = state.data?.own ?? [];
    const t = own.find((s) => s.setting_key === 'attendance_threshold')?.setting_value;
    setThreshold(t && typeof t.percent === 'number' ? String(t.percent) : '');
    const w = own.find((s) => s.setting_key === 'working_week')?.setting_value;
    setWeek(w && Array.isArray(w.days) ? (w.days as unknown[]).map(String) : ['0', '1', '2', '3', '4']);
  }, [state.data]);
  const put = async (key: string, value: Record<string, unknown>) => {
    try { await upsert('system_settings', { organization_id: org.id, setting_key: key, setting_value: value }, 'organization_id,setting_key'); toast.success(tr('تم الحفظ', 'Saved')); void state.reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const tNum = Number(threshold);
  const tValid = threshold !== '' && tNum >= 0 && tNum <= 100;
  const saveCustom = async () => {
    if (!custom) return;
    if (!/^[a-z][a-z0-9_.]{1,60}$/.test(custom.key)) { setJsonErr(tr('مفتاح غير صالح (أحرف لاتينية صغيرة، أرقام، _ .)', 'Invalid key (lowercase letters, digits, _ .)')); return; }
    let v: unknown;
    try { v = JSON.parse(custom.json); } catch { setJsonErr(tr('صيغة JSON غير صالحة', 'Invalid JSON')); return; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) { setJsonErr(tr('القيمة يجب أن تكون كائن JSON', 'The value must be a JSON object')); return; }
    await put(custom.key, v as Record<string, unknown>); setCustom(null);
  };
  const delSetting = async (s: SystemSetting) => {
    if (!(await confirm({ title: tr('حذف الإعداد؟', 'Delete setting?'), message: tr(`سيعود «${s.setting_key}» إلى القيمة الافتراضية للمنصة إن وُجدت.`, `“${s.setting_key}” falls back to the platform default if any.`), danger: true }))) return;
    try { await remove('system_settings', s.id); void state.reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  const columns: Column<SystemSetting>[] = [
    { key: 'setting_key', header: tr('المفتاح', 'Key'), render: (s) => <span className="mono small">{s.setting_key}</span> },
    { key: 'value', header: tr('القيمة', 'Value'), value: (s) => JSON.stringify(s.setting_value), render: (s) => <span className="mono tiny ltr">{JSON.stringify(s.setting_value)}</span> },
    { key: 'updated', header: tr('آخر تحديث', 'Updated'), value: (s) => s.updated_at, render: (s) => <span className="small">{fmtDateTime(s.updated_at)}</span> },
    { key: 'actions', header: '', hideInExport: true, render: (s) => (
      <div className="row" style={{ gap: 2 }}>
        <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => { setJsonErr(null); setCustom({ key: s.setting_key, json: JSON.stringify(s.setting_value, null, 2) }); }} />
        <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => void delSetting(s)} />
      </div>
    ) },
  ];
  return (
    <Card>
      <CardHeader title={tr('إعدادات التشغيل', 'Operating settings')} icon={<SlidersHorizontal />}
        actions={<Button size="sm" icon={<Plus />} onClick={() => { setJsonErr(null); setCustom({ key: '', json: '{\n  \n}' }); }}>{tr('إعداد مخصص', 'Custom setting')}</Button>} />
      <CardBody>
        <AsyncView state={state}>
          {(d) => (
            <div className="stack">
              <div className="grid g2">
                <div className="card card-pad stack-sm">
                  <b className="small">{tr('حد الحضور للإكمال', 'Attendance threshold for completion')}</b>
                  <span className="tiny muted">{tr('أقل نسبة حضور يُعد بعدها المستفيد مكملًا للبرنامج.', 'Minimum attendance rate for a beneficiary to count as completing the program.')}</span>
                  <div className="row"><Input type="number" dir="ltr" min={0} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} style={{ maxWidth: 110 }} aria-label="%" /><span>%</span>
                    <Button size="sm" variant="primary" disabled={!tValid} onClick={() => void put('attendance_threshold', { percent: tNum })}>{tr('حفظ', 'Save')}</Button></div>
                  {threshold !== '' && !tValid && <span className="tiny" style={{ color: 'var(--danger)' }}>{tr('بين 0 و100', 'Between 0 and 100')}</span>}
                  {tValid && tNum < 50 && <span className="tiny" style={{ color: 'var(--warning)' }}>{tr('حد منخفض؛ قد يُحتسب إكمال دون مشاركة فعلية.', 'Low threshold; completion may be counted without real participation.')}</span>}
                </div>
                <div className="card card-pad stack-sm">
                  <b className="small">{tr('أيام العمل', 'Working week')}</b>
                  <span className="tiny muted">{tr('تُستخدم في الجدولة والتنبيه عند جدولة جلسة في يوم عطلة.', 'Used in scheduling and to warn when a session falls on a non-working day.')}</span>
                  <MultiCheck options={enumOptions('weekday')} value={week} onChange={setWeek} />
                  <div><Button size="sm" variant="primary" disabled={!week.length} onClick={() => void put('working_week', { days: WEEKDAYS.filter((x) => week.includes(x)).map(Number) })}>{tr('حفظ', 'Save')}</Button></div>
                  {!week.length && <span className="tiny" style={{ color: 'var(--danger)' }}>{tr('اختر يومًا واحدًا على الأقل', 'Select at least one day')}</span>}
                </div>
              </div>
              <DataTable columns={columns} rows={d.own} rowKey={(s) => s.id} empty={{ title: tr('لا توجد إعدادات خاصة بالمؤسسة', 'No organization-specific settings') }} />
              {d.platform.length > 0 && (
                <details>
                  <summary className="small">{tr('القيم الافتراضية للمنصة (للقراءة)', 'Platform defaults (read-only)')}</summary>
                  <ul className="list-plain">{d.platform.map((s) => <li key={s.id} className="row between"><span className="mono small">{s.setting_key}</span><span className="mono tiny ltr">{JSON.stringify(s.setting_value)}</span></li>)}</ul>
                </details>
              )}
              <span className="tiny muted">{enumLabel('module', 'governance')} · {tr('تُحفظ القيم كـ JSON ويقرؤها النظام والخدمات الخلفية.', 'Values are stored as JSON and read by the system and backend services.')}</span>
            </div>
          )}
        </AsyncView>
      </CardBody>
      <Modal open={!!custom} onClose={() => setCustom(null)} title={tr('إعداد', 'Setting')}
        footer={<><Button onClick={() => setCustom(null)}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" onClick={() => void saveCustom()}>{tr('حفظ', 'Save')}</Button></>}>
        {custom && (
          <div className="stack">
            <Field label={tr('المفتاح', 'Key')} required><Input dir="ltr" value={custom.key} onChange={(e) => setCustom({ ...custom, key: e.target.value.trim() })} /></Field>
            <Field label={tr('القيمة (JSON)', 'Value (JSON)')} required error={jsonErr ?? undefined}><Textarea dir="ltr" className="mono" rows={8} value={custom.json} onChange={(e) => setCustom({ ...custom, json: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}

// ----------------------------------------------------------------------------- Notification rules
const CHANNELS = ['in_app', 'email', 'sms', 'whatsapp'];
type RuleDraft = { id?: string; name: string; event_type: string; audience: string; channels: string[]; offset_minutes: string; subject_template: string; body_template: string; status: 'active' | 'inactive' };

function NotificationRules() {
  const { tr, enumLabel, enumOptions, locale } = useI18n();
  const { org, can } = useOrg();
  const toast = useToast(); const confirm = useConfirm(); const errMsg = useErrMsg();
  const state = useAsync(() => all<NotificationRule>('notification_rules', { filters: [['organization_id', 'eq', org.id]], order: { column: 'event_type', ascending: true } }), [org.id]);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const offsetText = (m: number) => {
    if (!m) return tr('عند وقوع الحدث', 'At the event');
    const abs = Math.abs(m); const h = Math.floor(abs / 60); const mm = abs % 60;
    const span = locale === 'ar' ? `${h ? `${h} ساعة` : ''}${h && mm ? ' و' : ''}${mm ? `${mm} دقيقة` : ''}` : `${h ? `${h}h` : ''}${h && mm ? ' ' : ''}${mm ? `${mm}m` : ''}`;
    return m < 0 ? tr(`قبل ${span}`, `${span} before`) : tr(`بعد ${span}`, `${span} after`);
  };
  const open = (r?: NotificationRule) => {
    setSubmitted(false); setErr(null);
    setDraft(r ? { id: r.id, name: r.name, event_type: r.event_type, audience: r.audience, channels: r.channels, offset_minutes: String(r.offset_minutes), subject_template: r.subject_template ?? '', body_template: r.body_template ?? '', status: r.status }
      : { name: '', event_type: 'session_reminder', audience: 'participants', channels: ['in_app'], offset_minutes: '-1440', subject_template: '{{title}}', body_template: '{{program}} — {{starts_at}}', status: 'active' });
  };
  const offsetN = Number(draft?.offset_minutes);
  const valid = !!draft && !!draft.name.trim() && !!draft.channels.length && Number.isInteger(offsetN) && Math.abs(offsetN) <= 60 * 24 * 60;
  const save = async () => {
    setSubmitted(true);
    if (!draft || !valid) return;
    setBusy(true); setErr(null);
    const row = { name: draft.name.trim(), event_type: draft.event_type, audience: draft.audience, channels: draft.channels, offset_minutes: offsetN,
      subject_template: draft.subject_template.trim() || null, body_template: draft.body_template.trim() || null, status: draft.status };
    try {
      if (draft.id) await update('notification_rules', draft.id, row); else await insert('notification_rules', { ...row, organization_id: org.id });
      toast.success(tr('تم الحفظ', 'Saved')); setDraft(null); void state.reload();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const del = async (r: NotificationRule) => {
    if (!(await confirm({ title: tr('حذف القاعدة؟', 'Delete rule?'), message: r.name, danger: true }))) return;
    try { await remove('notification_rules', r.id); void state.reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  const columns: Column<NotificationRule>[] = [
    { key: 'name', header: tr('القاعدة', 'Rule'), render: (r) => <b className="small">{r.name}</b> },
    { key: 'event', header: tr('الحدث', 'Event'), value: (r) => enumLabel('eventType', r.event_type) },
    { key: 'audience', header: tr('الجمهور', 'Audience'), value: (r) => enumLabel('audience', r.audience) },
    { key: 'channels', header: tr('القنوات', 'Channels'), value: (r) => r.channels.join(','), render: (r) => <div className="row wrap" style={{ gap: 3 }}>{r.channels.map((c) => <Badge key={c} tone="outline">{enumLabel('channel', c)}</Badge>)}</div> },
    { key: 'offset', header: tr('التوقيت', 'Timing'), value: (r) => r.offset_minutes, render: (r) => <span className="small">{offsetText(r.offset_minutes)}</span> },
    { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <StatusBadge group="entityStatus" value={r.status} /> },
    { key: 'actions', header: '', hideInExport: true, render: (r) => (
      <div className="row" style={{ gap: 2 }}>
        {can('notifications.edit') && <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => open(r)} />}
        {can('notifications.delete') && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => void del(r)} />}
      </div>
    ) },
  ];
  const insertPh = (ph: string, field: 'subject_template' | 'body_template') => setDraft((d) => (d ? { ...d, [field]: `${d[field]}${d[field] && !d[field].endsWith(' ') ? ' ' : ''}${ph}` } : d));
  return (
    <Card>
      <CardHeader title={tr('قواعد الإشعارات', 'Notification rules')} icon={<BellRing />}
        actions={can('notifications.create') ? <Button size="sm" variant="primary" icon={<Plus />} onClick={() => open()}>{tr('قاعدة جديدة', 'New rule')}</Button> : undefined} />
      <CardBody flush>
        <AsyncView state={state}>
          {(rules) => <DataTable columns={columns} rows={rules} rowKey={(r) => r.id} exportName="notification-rules"
            empty={{ title: tr('لا توجد قواعد إشعارات', 'No notification rules'), description: tr('بدون قواعد لن تُرسل تذكيرات الجلسات أو تنبيهات الاعتماد.', 'Without rules no session reminders or approval alerts are sent.') }} />}
        </AsyncView>
      </CardBody>
      <Modal open={!!draft} onClose={() => setDraft(null)} size="wide" title={draft?.id ? tr('تعديل القاعدة', 'Edit rule') : tr('قاعدة جديدة', 'New rule')}
        footer={<><Button onClick={() => setDraft(null)}>{tr('إلغاء', 'Cancel')}</Button><Button variant="primary" loading={busy} onClick={save}>{tr('حفظ', 'Save')}</Button></>}>
        {draft && (
          <div className="stack">
            {err && <Notice tone="danger">{err}</Notice>}
            <div className="form-grid">
              <Field label={tr('الاسم', 'Name')} required error={submitted && !draft.name.trim() ? tr('إلزامي', 'Required') : undefined} className="full"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <Field label={tr('الحدث', 'Event')} required><Select options={enumOptions('eventType')} value={draft.event_type} onChange={(e) => setDraft({ ...draft, event_type: e.target.value })} /></Field>
              <Field label={tr('الجمهور', 'Audience')} required><Select options={enumOptions('audience')} value={draft.audience} onChange={(e) => setDraft({ ...draft, audience: e.target.value })} /></Field>
              <Field label={tr('القنوات', 'Channels')} required className="full" error={submitted && !draft.channels.length ? tr('اختر قناة واحدة على الأقل', 'Select at least one channel') : undefined}>
                <MultiCheck options={CHANNELS.map((c) => ({ value: c, label: enumLabel('channel', c) }))} value={draft.channels} onChange={(v) => setDraft({ ...draft, channels: v })} />
              </Field>
              <Field label={tr('الإزاحة بالدقائق', 'Offset (minutes)')} hint={`${tr('سالب = قبل الحدث', 'negative = before the event')} · ${Number.isInteger(offsetN) ? offsetText(offsetN) : '—'}`}
                error={submitted && !(Number.isInteger(offsetN) && Math.abs(offsetN) <= 86400) ? tr('عدد صحيح ضمن ±60 يومًا', 'Integer within ±60 days') : undefined}>
                <Input type="number" dir="ltr" step={1} value={draft.offset_minutes} onChange={(e) => setDraft({ ...draft, offset_minutes: e.target.value })} />
              </Field>
              <Field label={tr('الحالة', 'Status')}><Select options={[{ value: 'active', label: tr('نشطة', 'Active') }, { value: 'inactive', label: tr('غير نشطة', 'Inactive') }]} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as 'active' | 'inactive' })} /></Field>
              <Field label={tr('قالب العنوان', 'Subject template')} className="full"><Input value={draft.subject_template} onChange={(e) => setDraft({ ...draft, subject_template: e.target.value })} /></Field>
              <Field label={tr('قالب النص', 'Body template')} className="full"><Textarea rows={3} value={draft.body_template} onChange={(e) => setDraft({ ...draft, body_template: e.target.value })} /></Field>
            </div>
            <div className="row wrap" style={{ gap: 4 }}>
              <span className="tiny muted">{tr('متغيرات متاحة (انقر للإضافة للنص):', 'Placeholders (click to add to body):')}</span>
              {['{{title}}', '{{starts_at}}', '{{program}}'].map((ph) => <button key={ph} type="button" className="tag mono" onClick={() => insertPh(ph, 'body_template')}>{ph}</button>)}
            </div>
            {draft.event_type === 'session_reminder' && offsetN >= 0 && <Notice tone="warning">{tr('التذكير بإزاحة صفرية أو موجبة يصل عند بدء الجلسة أو بعدها؛ استخدم قيمة سالبة (مثل -1440 = قبل يوم).', 'A reminder with zero or positive offset arrives at or after the session start; use a negative value (e.g. -1440 = one day before).')}</Notice>}
            {draft.channels.some((c) => c !== 'in_app') && <Notice tone="info">{tr('قنوات البريد والرسائل تتطلب تهيئة المزود في الخادم؛ وإلا تُسجل الرسائل «تم تخطيه» مع السبب.', 'Email/SMS/WhatsApp require provider configuration on the server; otherwise messages are logged as “skipped” with a reason.')}</Notice>}
          </div>
        )}
      </Modal>
    </Card>
  );
}

