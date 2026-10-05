import { useEffect, useState } from 'react';
import { GraduationCap, Info, Plus, Save, ShieldAlert, Tags, Trash2, UserRound } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Notice, TagInput } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAction } from '@/hooks/useAction';
import { update } from '@/services/db';
import type { Expert } from '@/types/db';
import { InvitePortal } from '@/features/beneficiaries/components/InvitePortal';
import type { Qualification } from '../expertForm';
import type { E360 } from './data';

export function ProfileTab({ d }: { d: E360 }) {
  const { tr, enumLabel, fmtMoney, fmtNumber, fmtDate, pick } = useI18n();
  const e = d.expert;
  return (
    <div className="grid g-2-1">
      <Card>
        <CardHeader title={tr('الملف', 'Profile')} icon={<UserRound />} />
        <CardBody>
          <dl className="kv">
            <dt>{tr('الأدوار', 'Roles')}</dt><dd><span className="row wrap" style={{ gap: 4 }}>{e.roles.length ? e.roles.map((r) => <Badge key={r} tone="outline">{enumLabel('expertRole', r)}</Badge>) : '—'}</span></dd>
            <dt>{tr('البريد', 'Email')}</dt><dd className="ltr">{e.email ?? '—'}</dd>
            <dt>{tr('الجوال', 'Mobile')}</dt><dd className="ltr">{e.mobile ?? '—'}</dd>
            <dt>{tr('المدينة', 'City')}</dt><dd>{e.city ?? '—'}</dd>
            <dt>{tr('طرق التقديم', 'Delivery modes')}</dt><dd>{e.delivery_modes.map((m) => enumLabel('deliveryMode', m)).join('، ') || '—'}</dd>
            <dt>{tr('اللغات', 'Languages')}</dt><dd className="mono">{e.languages.join(', ') || '—'}</dd>
            <dt>{tr('سعر الساعة', 'Hourly rate')}</dt><dd>{e.hourly_rate === null ? '—' : fmtMoney(e.hourly_rate, e.currency)}</dd>
            <dt>{tr('الحد الأسبوعي', 'Weekly cap')}</dt><dd>{e.max_weekly_hours === null ? tr('غير محدد', 'Not set') : `${fmtNumber(e.max_weekly_hours)} ${tr('ساعة', 'h')}`}</dd>
            <dt>{tr('التقييم', 'Rating')}</dt><dd>{e.rating === null ? '—' : `${fmtNumber(e.rating, 2)} / 5`}</dd>
            <dt>{tr('مسجل منذ', 'Registered')}</dt><dd>{fmtDate(e.created_at)}</dd>
          </dl>
          {e.bio && <p className="small" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{e.bio}</p>}
          {!e.email && <Notice tone="warning">{tr('لا يوجد بريد للخبير؛ لن تصله إشعارات الجلسات ولا يمكن دعوته للبوابة.', 'The expert has no email; session notifications and portal invitations are not possible.')}</Notice>}
        </CardBody>
      </Card>
      <InvitePortal kind="expert" entityId={e.id} email={e.email} fullName={pick(e.full_name, e.full_name_en)} userId={e.user_id} />
    </div>
  );
}

export function ExpertiseTab({ d, onSaved }: { d: E360; onSaved: () => void }) {
  const { can } = useOrg();
  const { tr } = useI18n();
  const e = d.expert;
  const [v, setV] = useState({ expertise: e.expertise, sectors: e.sectors, languages: e.languages, conflicts: e.conflicts });
  useEffect(() => setV({ expertise: e.expertise, sectors: e.sectors, languages: e.languages, conflicts: e.conflicts }), [e]);
  const save = useAction(() => update<Expert>('experts', e.id, v), { success: ['تم الحفظ', 'Saved'], onDone: onSaved });
  const editable = can('experts.edit');
  const dirty = JSON.stringify(v) !== JSON.stringify({ expertise: e.expertise, sectors: e.sectors, languages: e.languages, conflicts: e.conflicts });
  const set = (k: keyof typeof v) => (x: string[]) => setV((s) => ({ ...s, [k]: x }));
  const view = (xs: string[]) => <div className="row wrap" style={{ gap: 4 }}>{xs.length ? xs.map((t) => <span key={t} className="tag">{t}</span>) : <span className="muted">—</span>}</div>;
  return (
    <div className="grid g-2-1">
      <Card>
        <CardHeader title={tr('الخبرات والقطاعات واللغات', 'Expertise, sectors & languages')} icon={<Tags />}
          actions={editable ? <Button size="sm" variant="primary" icon={<Save />} disabled={!dirty} loading={save.busy} onClick={() => void save.run()}>{tr('حفظ', 'Save')}</Button> : undefined} />
        <CardBody>
          <div className="stack-sm">
            <Field label={tr('مجالات الخبرة', 'Expertise')}>{editable ? <TagInput value={v.expertise} onChange={set('expertise')} /> : view(v.expertise)}</Field>
            <Field label={tr('القطاعات', 'Sectors')}>{editable ? <TagInput value={v.sectors} onChange={set('sectors')} /> : view(v.sectors)}</Field>
            <Field label={tr('اللغات (ar, en …)', 'Languages (ar, en …)')}>{editable ? <TagInput value={v.languages} onChange={set('languages')} /> : view(v.languages)}</Field>
            <Field label={<span className="row"><ShieldAlert size={14} />{tr('تعارض المصالح المُعلن', 'Declared conflicts of interest')}</span>}>{editable ? <TagInput value={v.conflicts} onChange={set('conflicts')} /> : view(v.conflicts)}</Field>
          </div>
        </CardBody>
      </Card>
      <Card tinted>
        <CardHeader title={tr('كيف تُستخدم في المطابقة', 'How this is used in matching')} icon={<Info />} />
        <CardBody>
          <ul className="small" style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 6 }}>
            <li>{tr('الخبرات تُقارن بالخبرات المطلوبة بمطابقة مرنة تراعي العربية (حتى 30 نقطة).', 'Expertise is compared with required expertise using Arabic-aware fuzzy matching (up to 30 points).')}</li>
            <li>{tr('القطاع واللغة يضيفان 10 نقاط لكل منهما عند التطابق.', 'Sector and language each add 10 points when matched.')}</li>
            <li>{tr('تعارض المصالح: إذا طابق أي بند مُعلن اسم الراعي أو المستفيد أو الفريق المطلوب، يُستبعد الخبير (غير مؤهل) مهما كانت درجته، ويظهر السبب.', 'Conflicts: if any declared item matches the sponsor, beneficiary or team being matched, the expert is excluded (not eligible) regardless of score, and the reason is shown.')}</li>
            <li>{tr('يضيف الخادم اسم الجهة الراعية للبرنامج تلقائيًا إلى أطراف فحص التعارض.', 'The server automatically adds the program sponsor’s name to the conflict check.')}</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

export function QualificationsTab({ d, onSaved }: { d: E360; onSaved: () => void }) {
  const { can } = useOrg();
  const { tr } = useI18n();
  const e = d.expert;
  const [rows, setRows] = useState<{ title: string; issuer: string; year: string }[]>([]);
  useEffect(() => setRows((e.qualifications ?? []).map((q) => ({ title: q.title ?? '', issuer: q.issuer ?? '', year: q.year ? String(q.year) : '' }))), [e]);
  const invalid = rows.some((r) => !r.title.trim() || (r.year && !/^\d{4}$/.test(r.year)));
  const save = useAction(() => {
    const q: Qualification[] = rows.map((r) => ({ title: r.title.trim(), ...(r.issuer.trim() ? { issuer: r.issuer.trim() } : {}), ...(r.year ? { year: Number(r.year) } : {}) }));
    return update<Expert>('experts', e.id, { qualifications: q });
  }, { success: ['تم حفظ المؤهلات', 'Qualifications saved'], onDone: onSaved });
  const editable = can('experts.edit');
  const setCell = (i: number, k: 'title' | 'issuer' | 'year', v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Card>
      <CardHeader title={tr('المؤهلات والشهادات', 'Qualifications & certifications')} icon={<GraduationCap />}
        actions={editable ? <>
          <Button size="sm" icon={<Plus />} onClick={() => setRows((r) => [...r, { title: '', issuer: '', year: '' }])}>{tr('إضافة', 'Add')}</Button>
          <Button size="sm" variant="primary" icon={<Save />} loading={save.busy} disabled={invalid} onClick={() => void save.run()}>{tr('حفظ', 'Save')}</Button>
        </> : undefined} />
      <CardBody flush>
        {rows.length === 0 ? <p className="card-pad muted small">{tr('لا توجد مؤهلات مسجلة. أضف الشهادات المهنية لدعم قرارات الإسناد.', 'No qualifications recorded. Add professional certifications to support assignment decisions.')}</p> : (
          <table className="table">
            <thead><tr><th>{tr('المؤهل', 'Qualification')}</th><th>{tr('الجهة المانحة', 'Issuer')}</th><th style={{ width: 110 }}>{tr('السنة', 'Year')}</th>{editable && <th style={{ width: 50 }} />}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{editable ? <Input value={r.title} invalid={!r.title.trim()} onChange={(x) => setCell(i, 'title', x.target.value)} /> : r.title}</td>
                  <td>{editable ? <Input value={r.issuer} onChange={(x) => setCell(i, 'issuer', x.target.value)} /> : r.issuer || '—'}</td>
                  <td>{editable ? <Input value={r.year} dir="ltr" invalid={!!r.year && !/^\d{4}$/.test(r.year)} onChange={(x) => setCell(i, 'year', x.target.value)} /> : r.year || '—'}</td>
                  {editable && <td><Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Delete')} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
