import { useMemo } from 'react';
import { Award, CalendarCheck, GraduationCap, Lightbulb, Percent, TrendingUp, UserRound } from 'lucide-react';
import { duePoints, type Insight } from '@engine';
import { Badge, Card, CardBody, CardHeader, InsightList, Kpi, scoreTone } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { todayISO } from '@/utils/dates';
import { InvitePortal } from '../InvitePortal';
import { makeInsight, sortInsights } from '../dataUtils';
import { attendanceStats, type B360 } from './data';

export function beneficiaryInsights(d: B360): Insight[] {
  const out: Insight[] = [];
  const today = todayISO();
  const att = attendanceStats(d);
  if (att.absent >= 3) {
    out.push(makeInsight({ rule: 'BEN_CHRONIC_ABSENCE', severity: att.absent >= 5 ? 'high' : 'medium', kind: 'risk', area: 'people',
      title: ['غياب متكرر', 'Chronic absence'],
      rationale: [`سُجّل غياب المستفيد في ${att.absent} جلسة من ${att.recorded} جلسة مسجلة الحضور.`, `The beneficiary was absent from ${att.absent} of ${att.recorded} sessions with recorded attendance.`],
      action: ['تواصل مع المستفيد لفهم أسباب الغياب وسجّل إجراء متابعة أو خطة دعم.', 'Contact the beneficiary to understand the absences and log a follow-up action or support plan.'],
      data: { absent: att.absent, recorded: att.recorded } }));
  }
  if (att.unrecorded > 0) {
    out.push(makeInsight({ rule: 'BEN_ATTENDANCE_UNRECORDED', severity: 'low', kind: 'data_quality', area: 'delivery',
      title: ['حضور غير مسجل', 'Attendance not recorded'],
      rationale: [`${att.unrecorded} جلسة سابقة لم يُسجل فيها حضور المستفيد؛ نسبة الحضور المحسوبة قد لا تكون دقيقة.`, `${att.unrecorded} past sessions have no attendance recorded for this beneficiary; the computed attendance rate may be inaccurate.`],
      action: ['سجّل الحضور من التشغيل ← الجلسات.', 'Record attendance under Operations → Sessions.'] }));
  }
  for (const e of d.enrollments.filter((x) => ['active', 'completed', 'graduated'].includes(x.status))) {
    const p = d.programs.get(e.program_id);
    if (!p) continue;
    const started = !!p.start_date && p.start_date <= today;
    const due = duePoints(p.end_date).filter((pt) => pt === 'T0' ? started : pt === 'T1');
    const have = new Set<string>(d.maturity.filter((m) => m.program_id === p.id).map((m) => m.measurement_point));
    const missing = due.filter((pt) => !have.has(pt));
    if (missing.length) {
      out.push(makeInsight({ rule: 'BEN_MATURITY_MISSING', key: `${p.id}:${missing.join(',')}`, severity: missing.includes('T0') ? 'medium' : 'high', kind: 'gap', area: 'measurement',
        title: [`قياس نضج ناقص (${missing.join('، ')}) — ${p.name}`, `Missing maturity measurement (${missing.join(', ')}) — ${p.name_en || p.name}`],
        rationale: [`تواريخ البرنامج تتطلب قياس ${missing.join(' و')} لهذا المستفيد ولا يوجد قياس مسجل؛ لن يمكن حساب التغير قبل/بعد.`,
          `Program dates require ${missing.join(' and ')} for this beneficiary but none is recorded; before/after change cannot be computed.`],
        action: ['سجّل قياس النضج من مساحة البرنامج ← التقييم.', 'Record the maturity assessment from the program workspace → Assessment.'] }));
    }
    if (started && !d.results.some((r) => r.program_id === p.id)) {
      out.push(makeInsight({ rule: 'BEN_NO_RESULTS', key: p.id, severity: 'low', kind: 'gap', area: 'measurement',
        title: [`لا توجد نتائج تقييم — ${p.name}`, `No assessment results — ${p.name_en || p.name}`],
        rationale: ['المستفيد ملتحق ببرنامج بدأ ولا توجد له نتائج أدوات تقييم.', 'The beneficiary is enrolled in a started program but has no assessment tool results.'],
        action: ['أدخل نتيجة تقييم داخلية أو استورد نتائج أداة خارجية.', 'Enter an internal assessment result or import external tool results.'] }));
    }
  }
  for (const e of d.enrollments.filter((x) => ['withdrawn', 'dropped'].includes(x.status) && !x.exit_reason)) {
    out.push(makeInsight({ rule: 'BEN_EXIT_NO_REASON', key: e.id, severity: 'low', kind: 'data_quality', area: 'people',
      title: ['انسحاب بلا سبب موثق', 'Exit without documented reason'],
      rationale: ['سبب الانسحاب يدعم تحليل التسرب وتحسين البرامج.', 'Exit reasons support dropout analysis and program improvement.'],
      action: ['أضف سبب الخروج في سجل الالتحاق.', 'Add the exit reason on the enrollment.'] }));
  }
  const pendingEv = d.evidence.filter((e) => ['pending', 'needs_info'].includes(e.verification_status));
  if (pendingEv.length) {
    out.push(makeInsight({ rule: 'BEN_EVIDENCE_PENDING', severity: pendingEv.some((e) => e.verification_status === 'needs_info') ? 'medium' : 'low', kind: 'evidence_gap', area: 'evidence',
      title: ['أدلة بانتظار التحقق', 'Evidence awaiting verification'],
      rationale: [`${pendingEv.length} دليل مرتبط بالمستفيد غير متحقق منه؛ الأدلة غير المتحقق منها تُضعف ادعاءات النتائج.`, `${pendingEv.length} evidence items linked to this beneficiary are not verified; unverified evidence weakens outcome claims.`],
      action: ['راجع الأدلة من وحدة الأدلة.', 'Review them in the Evidence module.'] }));
  }
  const overdue = d.actions.filter((a) => ['open', 'in_progress'].includes(a.status) && a.due_date && a.due_date < today);
  if (overdue.length) {
    out.push(makeInsight({ rule: 'BEN_ACTIONS_OVERDUE', severity: 'high', kind: 'blocker', area: 'delivery',
      title: ['إجراءات متأخرة', 'Overdue actions'],
      rationale: [`${overdue.length} إجراء مرتبط بالمستفيد تجاوز تاريخ الاستحقاق: ${overdue.slice(0, 3).map((a) => a.title).join('، ')}`, `${overdue.length} actions linked to this beneficiary are past due: ${overdue.slice(0, 3).map((a) => a.title).join(', ')}`],
      action: ['حدّث حالة الإجراءات أو أعد جدولتها من لوحة الإجراءات.', 'Update or reschedule them from the actions board.'] }));
  }
  if (!d.ben.consent_given) {
    out.push(makeInsight({ rule: 'BEN_NO_CONSENT', severity: 'medium', kind: 'data_quality', area: 'setup',
      title: ['موافقة معالجة البيانات غير مسجلة', 'Data-processing consent not recorded'],
      rationale: ['يجب توثيق موافقة المستفيد قبل استخدام بياناته في التقارير والأثر.', 'Beneficiary consent should be documented before using their data in reports and impact analysis.'],
      action: ['احصل على الموافقة وحدّث الملف.', 'Obtain consent and update the profile.'] }));
  }
  if (!d.ben.email && !d.ben.mobile) {
    out.push(makeInsight({ rule: 'BEN_NO_CONTACT', severity: 'low', kind: 'missing_config', area: 'setup',
      title: ['لا توجد بيانات تواصل', 'No contact details'],
      rationale: ['لا يمكن إرسال إشعارات الجلسات أو دعوة البوابة أو متابعات الأثر بدون بريد أو جوال.', 'Session notifications, portal invitations and impact follow-ups need an email or mobile.'],
      action: ['أضف البريد أو الجوال.', 'Add an email or mobile number.'] }));
  }
  return sortInsights(out);
}

export function OverviewTab({ d }: { d: B360 }) {
  const { tr, fmtNumber, fmtDate, enumLabel, pick } = useI18n();
  const att = useMemo(() => attendanceStats(d), [d]);
  const insights = useMemo(() => beneficiaryInsights(d), [d]);
  const latest = d.maturity.length ? d.maturity[d.maturity.length - 1] : null;
  const latestFw = latest ? d.frameworks.get(latest.framework_id) : null;
  const latestPct = latest?.overall_score !== null && latest?.overall_score !== undefined && latestFw ? Math.round((latest.overall_score / latestFw.scale_max) * 100) : null;
  const certs = d.certificates.filter((c) => c.status === 'issued');
  const b = d.ben;
  return (
    <div className="stack">
      <div className="grid g5">
        <Kpi label={tr('البرامج', 'Programs')} icon={<GraduationCap size={14} />} value={fmtNumber(d.enrollments.length)} hint={tr(`${d.applications.length} طلب التحاق`, `${d.applications.length} applications`)} />
        <Kpi label={tr('نسبة الحضور', 'Attendance rate')} icon={<Percent size={14} />} value={att.rate === null ? '—' : `${att.rate}%`} tone={scoreTone(att.rate)}
          hint={tr(`من ${att.recorded} جلسة مسجلة`, `of ${att.recorded} recorded sessions`)} />
        <Kpi label={tr('جلسات حضرها', 'Sessions attended')} icon={<CalendarCheck size={14} />} value={fmtNumber(att.attended)} hint={tr(`${att.absent} غياب`, `${att.absent} absences`)} tone={att.absent >= 3 ? 'warning' : undefined} />
        <Kpi label={tr('آخر نضج', 'Latest maturity')} icon={<TrendingUp size={14} />} value={latest?.overall_score ?? '—'}
          hint={latest ? `${latest.measurement_point} · ${fmtDate(latest.assessed_at)}${latestPct !== null ? ` · ${latestPct}%` : ''}` : tr('لا قياس', 'Not measured')} />
        <Kpi label={tr('الشهادات', 'Certificates')} icon={<Award size={14} />} value={fmtNumber(certs.length)} />
      </div>
      <div className="grid g-2-1">
        <Card>
          <CardHeader title={tr('ملاحظات الخبير', 'Expert insights')} icon={<Lightbulb />} hint={tr('محسوبة بالقواعد من بيانات المستفيد', 'Rule-based, computed from this beneficiary’s data')} />
          <CardBody><InsightList insights={insights} /></CardBody>
        </Card>
        <div className="stack">
          <Card>
            <CardHeader title={tr('الملف', 'Profile')} icon={<UserRound />} />
            <CardBody>
              <dl className="kv">
                <dt>{tr('الهوية', 'National ID')}</dt><dd className="mono">{b.national_id ?? '—'}</dd>
                <dt>{tr('الجنس', 'Gender')}</dt><dd>{enumLabel('gender', b.gender)}</dd>
                <dt>{tr('تاريخ الميلاد', 'Birth date')}</dt><dd>{fmtDate(b.birth_date)}</dd>
                <dt>{tr('الجوال', 'Mobile')}</dt><dd className="ltr">{b.mobile ?? '—'}</dd>
                <dt>{tr('البريد', 'Email')}</dt><dd className="ltr">{b.email ?? '—'}</dd>
                <dt>{tr('المدينة / المنطقة', 'City / region')}</dt><dd>{[b.city, b.region].filter(Boolean).join(' · ') || '—'}</dd>
                <dt>{tr('التعليم', 'Education')}</dt><dd>{[b.education_level, b.specialization].filter(Boolean).join(' · ') || '—'}</dd>
                <dt>{tr('الحالة الوظيفية', 'Employment')}</dt><dd>{enumLabel('employment', b.employment_status)}{b.organization_name ? ` · ${b.organization_name}` : ''}</dd>
                <dt>{tr('الموافقة', 'Consent')}</dt><dd>{b.consent_given ? <Badge tone="success">{tr('موثقة', 'Recorded')} {b.consent_at ? fmtDate(b.consent_at) : ''}</Badge> : <Badge tone="warning">{tr('غير موثقة', 'Not recorded')}</Badge>}</dd>
                <dt>{tr('الوسوم', 'Tags')}</dt><dd>{b.tags?.length ? <span className="row wrap" style={{ gap: 4 }}>{b.tags.map((t) => <span key={t} className="tag">{t}</span>)}</span> : '—'}</dd>
              </dl>
              {b.notes && <p className="small muted" style={{ marginTop: 8 }}>{b.notes}</p>}
            </CardBody>
          </Card>
          <InvitePortal kind="beneficiary" entityId={b.id} email={b.email} fullName={pick(b.full_name, b.full_name_en)} userId={b.user_id} />
        </div>
      </div>
    </div>
  );
}
