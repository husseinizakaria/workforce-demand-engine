// Program health check — the platform's expert rules. Produces explainable
// insights (rationale + source data + recommended action) and a health score.
// Used live in the browser and server-side by program-health-check /
// ai-program-analysis Edge Functions.
import {
  type HealthArea, type Insight, type InsightKind, type L10n, type ProgramBundle, type Severity,
  SEVERITY_ORDER, SEVERITY_WEIGHT, daysBetween, l, roundTo,
} from './types.ts';
import { TRACK_BY_CODE } from './tracks.ts';
import { assessClaim, elapsedShare, indicatorPerformance, resultsChainCompleteness } from './impact.ts';
import { duePoints } from './maturity.ts';
import { evidenceCompleteness } from './evidence.ts';

export interface HealthReport {
  score: number;
  grade: 'good' | 'watch' | 'at_risk' | 'critical';
  areas: Record<HealthArea, number>;
  insights: Insight[];
  next_actions: Insight[];
  metrics: Record<string, number | null>;
  generated_at: string;
}

function mk(
  rule_code: string, kind: InsightKind, severity: Severity, area: HealthArea,
  title: L10n, rationale: L10n, action: L10n, source: Record<string, unknown>, programId: string, link?: string, suffix = '',
): Insight {
  return { rule_code, kind, severity, area, title, rationale, recommended_action: action, source_data: source,
    fingerprint: `${programId}:${rule_code}${suffix ? ':' + suffix : ''}`, link };
}

const ACTIVE_PROGRAM = new Set(['active', 'planning']);

export function programHealth(b: ProgramBundle, today: Date = new Date()): HealthReport {
  const p = b.program; const pid = p.id; const out: Insight[] = [];
  const todayStr = today.toISOString().slice(0, 10);
  const track = TRACK_BY_CODE[p.track_code];
  const isActive = ACTIVE_PROGRAM.has(p.status);
  const started = !!p.start_date && p.start_date <= todayStr;
  const ended = !!p.end_date && p.end_date < todayStr;
  const share = elapsedShare(p.start_date, p.end_date, today);

  // ------------------------------------------------------------ setup
  if (!p.start_date || !p.end_date) out.push(mk('CFG_DATES', 'missing_config', isActive ? 'high' : 'medium', 'setup',
    l('تواريخ البرنامج غير مكتملة', 'Program dates are incomplete'),
    l('بدون تاريخي البداية والنهاية لا يمكن احتساب نقاط القياس (T1–T5) ولا تقدم المؤشرات مقابل الزمن.', 'Without start and end dates, measurement points (T1–T5) and time-based KPI progress cannot be computed.'),
    l('أدخل تاريخي البداية والنهاية في نظرة عامة البرنامج.', 'Set start and end dates in the program overview.'), { start_date: p.start_date, end_date: p.end_date }, pid, 'overview'));
  if (p.target_beneficiaries === null) out.push(mk('CFG_TARGET', 'missing_config', 'low', 'setup',
    l('لا يوجد مستهدف لعدد المستفيدين', 'No beneficiary target'),
    l('المستهدف ضروري لقياس الوصول ومقارنة التسجيل الفعلي.', 'A target is needed to measure reach against actual enrollment.'),
    l('حدد العدد المستهدف من المستفيدين.', 'Set the target number of beneficiaries.'), {}, pid, 'overview'));

  const enrolled = b.enrollments.filter((e) => !['withdrawn', 'dropped'].includes(e.status)).length;
  if (p.target_beneficiaries && enrolled > p.target_beneficiaries * 1.1) out.push(mk('CFG_OVER_TARGET', 'inconsistency', 'low', 'setup',
    l('التسجيل يتجاوز المستهدف', 'Enrollment exceeds target'),
    l(`المسجلون ${enrolled} مقابل مستهدف ${p.target_beneficiaries}؛ قد يؤثر ذلك على الطاقة الاستيعابية والميزانية.`, `${enrolled} enrolled against a target of ${p.target_beneficiaries}; capacity and budget may be affected.`),
    l('راجع المستهدف أو الطاقة الاستيعابية للدفعات.', 'Review the target or cohort capacity.'), { enrolled, target: p.target_beneficiaries }, pid, 'participants'));
  if (p.target_beneficiaries && share !== null && share > 0.3 && enrolled < p.target_beneficiaries * 0.7) out.push(mk('REACH_LOW', 'risk', 'medium', 'delivery',
    l('الوصول أقل من المستهدف', 'Reach below target'),
    l(`مضى ${Math.round(share * 100)}% من مدة البرنامج والمسجلون ${enrolled} من ${p.target_beneficiaries}.`, `${Math.round(share * 100)}% of the program period has elapsed with ${enrolled} of ${p.target_beneficiaries} enrolled.`),
    l('راجع قنوات الاستقطاب وقوائم الانتظار والمقبولين غير المسجلين.', 'Review recruitment channels, waitlists and accepted-but-not-enrolled applicants.'), { enrolled, target: p.target_beneficiaries, elapsed: share }, pid, 'participants'));

  const accepted = b.applications.filter((a) => a.status === 'accepted').map((a) => a.beneficiary_id);
  const enrolledIds = new Set(b.enrollments.map((e) => e.beneficiary_id));
  const notEnrolled = accepted.filter((x) => !enrolledIds.has(x));
  if (notEnrolled.length) out.push(mk('APP_ACCEPTED_NOT_ENROLLED', 'gap', 'medium', 'delivery',
    l('مقبولون غير مسجلين في البرنامج', 'Accepted applicants not enrolled'),
    l(`${notEnrolled.length} طلب مقبول بلا تسجيل؛ لن يظهروا في الحضور والقياس.`, `${notEnrolled.length} accepted applications without enrollment; they will be missing from attendance and measurement.`),
    l('سجّل المقبولين أو حدّث حالة الطلب.', 'Enroll accepted applicants or update application status.'), { count: notEnrolled.length }, pid, 'participants'));

  const needsCohorts = ['bootcamp', 'vocational', 'graduate'].includes(p.track_code);
  if (needsCohorts && isActive && b.cohorts.length === 0) out.push(mk('CFG_NO_COHORT', 'missing_config', 'medium', 'setup',
    l('لا توجد دفعات', 'No cohorts defined'),
    l(`مسار ${track?.name_ar ?? p.track_code} يعتمد على الدفعات لتنظيم الجلسات والقياس.`, `The ${track?.name_en ?? p.track_code} track relies on cohorts to organize sessions and measurement.`),
    l('أنشئ دفعة واحدة على الأقل وحدد طاقتها وتواريخها.', 'Create at least one cohort with capacity and dates.'), {}, pid, 'participants'));
  for (const c of b.cohorts) {
    if (c.capacity !== null) {
      const n = b.enrollments.filter((e) => e.cohort_id === c.id && !['withdrawn', 'dropped'].includes(e.status)).length;
      if (n > c.capacity) out.push(mk('COHORT_OVER_CAPACITY', 'inconsistency', 'medium', 'delivery',
        l(`الدفعة «${c.name}» تتجاوز طاقتها`, `Cohort “${c.name}” exceeds capacity`),
        l(`${n} مسجل مقابل طاقة ${c.capacity}.`, `${n} enrolled against capacity ${c.capacity}.`),
        l('وزّع المستفيدين على دفعات أخرى أو ارفع الطاقة.', 'Redistribute beneficiaries or increase capacity.'), { cohort_id: c.id, enrolled: n, capacity: c.capacity }, pid, 'participants', c.id));
    }
    if (p.start_date && c.start_date && c.start_date < p.start_date || p.end_date && c.end_date && c.end_date > p.end_date) out.push(mk('COHORT_DATES', 'inconsistency', 'low', 'setup',
      l(`تواريخ الدفعة «${c.name}» خارج مدة البرنامج`, `Cohort “${c.name}” dates fall outside the program`),
      l('تعارض التواريخ يربك الجدولة ونقاط القياس.', 'Date conflicts confuse scheduling and measurement points.'),
      l('وحّد تواريخ الدفعة مع البرنامج.', 'Align cohort dates with the program.'), { cohort_id: c.id }, pid, 'participants', c.id));
  }

  // ------------------------------------------------------------ journey
  const stageByKey = new Map(b.stages.map((s) => [s.stage_key, s]));
  for (const s of b.stages) {
    const name = l(s.name_ar, s.name_en ?? s.name_ar);
    if (s.status === 'blocked') out.push(mk('STAGE_BLOCKED', 'blocker', 'high', 'delivery',
      l(`المرحلة «${name.ar}» متوقفة`, `Stage “${name.en}” is blocked`),
      l(`سبب التوقف: ${s.blocker_note ?? 'غير موثق'}.`, `Blocker: ${s.blocker_note ?? 'not documented'}.`),
      l('عالج سبب التوقف أو صعّده كقضية في الحوكمة.', 'Resolve the blocker or escalate it as a governance issue.'), { stage_key: s.stage_key, note: s.blocker_note }, pid, 'journey', s.stage_key));
    if ((s.status === 'in_progress' || s.status === 'completed') && s.depends_on.some((d) => !['completed', 'skipped'].includes(stageByKey.get(d)?.status ?? '')))
      out.push(mk('STAGE_DEPENDENCY', 'inconsistency', 'medium', 'delivery',
        l(`المرحلة «${name.ar}» بدأت قبل اكتمال متطلباتها`, `Stage “${name.en}” started before its prerequisites`),
        l(`المراحل السابقة غير المكتملة: ${s.depends_on.filter((d) => !['completed', 'skipped'].includes(stageByKey.get(d)?.status ?? '')).map((d) => stageByKey.get(d)?.name_ar ?? d).join('، ')}.`,
          `Incomplete prerequisites: ${s.depends_on.filter((d) => !['completed', 'skipped'].includes(stageByKey.get(d)?.status ?? '')).map((d) => stageByKey.get(d)?.name_en ?? d).join(', ')}.`),
        l('أكمل المراحل السابقة أو وثّق مبرر التجاوز.', 'Complete prerequisites or document the override rationale.'), { stage_key: s.stage_key }, pid, 'journey', s.stage_key));
    if (s.status === 'in_progress' && s.planned_end && s.planned_end < todayStr) out.push(mk('STAGE_OVERDUE', 'risk', 'medium', 'delivery',
      l(`المرحلة «${name.ar}» متأخرة`, `Stage “${name.en}” is overdue`),
      l(`كان مخططًا انتهاؤها في ${s.planned_end} (متأخرة ${daysBetween(s.planned_end, todayStr)} يومًا).`, `Planned to end on ${s.planned_end} (${daysBetween(s.planned_end, todayStr)} days late).`),
      l('حدّث الخطة الزمنية أو أضف موارد للمرحلة.', 'Re-plan the timeline or add resources.'), { stage_key: s.stage_key, planned_end: s.planned_end }, pid, 'journey', s.stage_key));
    if (s.status === 'not_started' && s.planned_start && s.planned_start < todayStr && isActive && s.depends_on.every((d) => ['completed', 'skipped'].includes(stageByKey.get(d)?.status ?? '')))
      out.push(mk('STAGE_NOT_STARTED', 'risk', 'low', 'delivery',
        l(`المرحلة «${name.ar}» لم تبدأ في موعدها`, `Stage “${name.en}” has not started on time`),
        l(`موعد البدء المخطط ${s.planned_start} ومتطلباتها مكتملة.`, `Planned start ${s.planned_start}; prerequisites are complete.`),
        l('ابدأ المرحلة أو حدّث موعدها.', 'Start the stage or update its date.'), { stage_key: s.stage_key }, pid, 'journey', s.stage_key));
    if (s.requires_approval && s.approval_status === 'pending') {
      const ap = b.approvalsPending.find((a) => a.entity_type === 'program_stage' && a.entity_id === s.id);
      const age = ap ? daysBetween(ap.created_at.slice(0, 10), todayStr) : null;
      if (age === null || age > 5) out.push(mk('STAGE_APPROVAL_WAITING', 'blocker', 'medium', 'delivery',
        l(`اعتماد المرحلة «${name.ar}» معلق`, `Approval pending for “${name.en}”`),
        l(age === null ? 'طلب الاعتماد معلق.' : `طلب الاعتماد معلق منذ ${age} يومًا.`, age === null ? 'Approval request is pending.' : `Approval has been pending for ${age} days.`),
        l('تابع مع المعتمد في شاشة الحوكمة.', 'Follow up with the approver in Governance.'), { stage_key: s.stage_key, age_days: age }, pid, 'journey', s.stage_key));
    }
    if (s.status === 'completed' && s.record_types.length && !b.stageRecords.some((r) => r.stage_key === s.stage_key))
      out.push(mk('STAGE_NO_RECORDS', 'data_quality', 'low', 'evidence',
        l(`المرحلة «${name.ar}» مكتملة دون سجلات`, `Stage “${name.en}” completed without records`),
        l('لا توجد سجلات تشغيلية (نماذج المرحلة) تدعم الإكمال.', 'No operational stage records support completion.'),
        l('أضف سجلات المرحلة أو وثّق سبب عدم الحاجة لها.', 'Add stage records or document why none are needed.'), { stage_key: s.stage_key }, pid, 'journey', s.stage_key));
  }
  const inProgress = b.stages.filter((s) => s.status === 'in_progress').length;
  const doneStages = b.stages.filter((s) => ['completed', 'skipped'].includes(s.status)).length;
  if (p.status === 'active' && b.stages.length && inProgress === 0 && doneStages < b.stages.length) out.push(mk('JOURNEY_STALLED', 'blocker', 'medium', 'delivery',
    l('لا توجد مرحلة قيد التنفيذ', 'No stage in progress'),
    l('البرنامج نشط لكن لا توجد مرحلة جارية في الرحلة.', 'The program is active but no journey stage is in progress.'),
    l('ابدأ المرحلة التالية المتاحة في الرحلة.', 'Start the next available journey stage.'), { completed: doneStages, total: b.stages.length }, pid, 'journey'));
  if (ended && ['active', 'planning'].includes(p.status)) out.push(mk('PROGRAM_PAST_END', 'inconsistency', 'medium', 'setup',
    l('البرنامج تجاوز تاريخ نهايته وما زال نشطًا', 'Program past its end date but still active'),
    l(`تاريخ النهاية ${p.end_date}.`, `End date was ${p.end_date}.`),
    l('أغلق البرنامج أو حدّث تاريخ النهاية؛ ثم خطط لقياسات المتابعة T2–T5.', 'Close the program or update the end date, then plan follow-ups T2–T5.'), { end_date: p.end_date }, pid, 'overview'));

  // ------------------------------------------------------------ operations
  const sessions = b.sessions;
  const now = today.getTime();
  const upcoming = sessions.filter((s) => s.status === 'scheduled' && new Date(s.starts_at).getTime() >= now);
  const next14 = upcoming.filter((s) => new Date(s.starts_at).getTime() <= now + 14 * 86400000);
  if (p.status === 'active' && !ended && started && next14.length === 0) out.push(mk('OPS_NO_UPCOMING', 'gap', 'medium', 'delivery',
    l('لا توجد جلسات مجدولة خلال 14 يومًا', 'No sessions scheduled in the next 14 days'),
    l('البرنامج نشط دون جلسات قادمة قريبة.', 'The program is active without near-term sessions.'),
    l('جدول الجلسات القادمة أو استخدم الجدولة المجمعة.', 'Schedule upcoming sessions or use bulk scheduling.'), { upcoming: upcoming.length }, pid, 'delivery'));
  const pastOpen = sessions.filter((s) => s.status === 'scheduled' && new Date(s.ends_at).getTime() < now);
  if (pastOpen.length) out.push(mk('OPS_UNCLOSED', 'data_quality', pastOpen.length > 5 ? 'medium' : 'low', 'delivery',
    l('جلسات منتهية لم تُغلق', 'Past sessions not closed'),
    l(`${pastOpen.length} جلسة انتهى وقتها وما زالت «مجدولة»؛ الحضور والساعات غير محتسبة.`, `${pastOpen.length} sessions have ended but remain “scheduled”; attendance and hours are not counted.`),
    l('أكمل الجلسات وسجّل الحضور والملخص والتوصيات.', 'Complete sessions and record attendance, summary and recommendations.'), { sessions: pastOpen.map((s) => s.code).slice(0, 20) }, pid, 'delivery'));
  const completed = sessions.filter((s) => s.status === 'completed');
  const partBySession = new Map<string, typeof b.participants>();
  for (const pt of b.participants) { const arr = partBySession.get(pt.session_id) ?? []; arr.push(pt); partBySession.set(pt.session_id, arr); }
  const noAttendance = completed.filter((s) => { const ps = partBySession.get(s.id) ?? []; return ps.length === 0 || ps.every((x) => x.attendance_status === 'unknown'); });
  if (noAttendance.length) out.push(mk('OPS_NO_ATTENDANCE', 'data_quality', 'medium', 'evidence',
    l('جلسات مكتملة دون حضور مسجل', 'Completed sessions without attendance'),
    l(`${noAttendance.length} جلسة مكتملة بلا بيانات حضور؛ مؤشرات المشاركة غير موثوقة.`, `${noAttendance.length} completed sessions lack attendance; participation metrics are unreliable.`),
    l('سجّل الحضور لهذه الجلسات.', 'Record attendance for these sessions.'), { sessions: noAttendance.map((s) => s.code).slice(0, 20) }, pid, 'delivery'));
  const marked = b.participants.filter((x) => x.attendance_status !== 'unknown');
  const present = marked.filter((x) => x.attendance_status === 'present' || x.attendance_status === 'late').length;
  const attendanceRate = marked.length ? roundTo((present / marked.length) * 100, 1) : null;
  if (attendanceRate !== null && marked.length >= 10 && attendanceRate < 75) out.push(mk('OPS_LOW_ATTENDANCE', 'risk', attendanceRate < 60 ? 'high' : 'medium', 'delivery',
    l('نسبة الحضور منخفضة', 'Low attendance'),
    l(`نسبة الحضور ${attendanceRate}% من ${marked.length} تسجيل حضور.`, `Attendance is ${attendanceRate}% across ${marked.length} records.`),
    l('حلل أسباب الغياب حسب الدفعة والتوقيت وفعّل التذكيرات.', 'Analyze absence by cohort and timing; enable reminders.'), { attendance_rate: attendanceRate, records: marked.length }, pid, 'delivery'));
  const absences = new Map<string, number>();
  for (const x of b.participants) if (x.attendance_status === 'absent') absences.set(x.beneficiary_id, (absences.get(x.beneficiary_id) ?? 0) + 1);
  const chronic = [...absences.entries()].filter(([, c]) => c >= 3);
  if (chronic.length) out.push(mk('OPS_CHRONIC_ABSENCE', 'risk', 'medium', 'people',
    l('مستفيدون بغياب متكرر', 'Beneficiaries with repeated absence'),
    l(`${chronic.length} مستفيد غابوا 3 جلسات أو أكثر؛ خطر انسحاب.`, `${chronic.length} beneficiaries missed 3+ sessions; dropout risk.`),
    l('تواصل معهم وأنشئ إجراءات متابعة فردية.', 'Contact them and create individual follow-up actions.'),
    { beneficiaries: chronic.map(([id, c]) => ({ id, absences: c })).slice(0, 20) }, pid, 'participants'));

  // Experts
  const needsMentors = b.stages.some((s) => ['mentoring', 'mentoring_coaching', 'judging', 'matching', 'session'].includes(s.stage_key));
  const activeAssign = b.assignments.filter((a) => ['proposed', 'confirmed', 'active'].includes(a.status));
  if (needsMentors && isActive && activeAssign.length === 0) out.push(mk('EXPERTS_NONE', 'gap', 'medium', 'people',
    l('لا يوجد خبراء مُسندون', 'No experts assigned'),
    l('رحلة هذا المسار تتضمن إرشادًا/تحكيمًا/استشارات تتطلب خبراء.', 'This track includes mentoring/judging/consulting that requires experts.'),
    l('استخدم المطابقة الذكية لإسناد خبراء مناسبين.', 'Use smart matching to assign suitable experts.'), {}, pid, 'experts'));
  const judgingStage = stageByKey.get('judging');
  if (judgingStage && judgingStage.status !== 'completed') {
    const judges = activeAssign.filter((a) => a.role === 'judge');
    if (judges.length > 0 && judges.length < 3) out.push(mk('JUDGES_FEW', 'risk', 'low', 'people',
      l('عدد المحكّمين أقل من 3', 'Fewer than 3 judges'),
      l('التحكيم بأقل من 3 محكّمين يزيد أثر الانحياز الفردي.', 'Judging with fewer than 3 judges increases individual bias.'),
      l('أضف محكّمين ليصل العدد إلى 3 على الأقل.', 'Add judges to reach at least 3.'), { judges: judges.length }, pid, 'experts'));
  }
  if (b.sponsorName) for (const e of b.experts) {
    const assigned = activeAssign.some((a) => a.expert_id === e.id);
    if (assigned && e.conflicts.some((c) => c && b.sponsorName && (c.includes(b.sponsorName) || b.sponsorName.includes(c))))
      out.push(mk('EXPERT_CONFLICT', 'conflict', 'high', 'people',
        l(`تعارض مصالح محتمل للخبير ${e.full_name}`, `Potential conflict of interest: ${e.full_name}`),
        l(`أعلن الخبير تعارضًا مع «${b.sponsorName}» الجهة الراعية للبرنامج.`, `The expert declared a conflict with “${b.sponsorName}”, the program sponsor.`),
        l('راجع الإسناد أو وثّق قرار الاستثناء.', 'Review the assignment or document an exception decision.'), { expert_id: e.id }, pid, 'experts', e.id));
  }

  // ------------------------------------------------------------ measurement
  const chain = resultsChainCompleteness(b.impactFramework, b.indicators);
  if (!b.impactFramework) out.push(mk('IMPACT_NO_FRAMEWORK', 'missing_config', isActive ? 'high' : 'medium', 'measurement',
    l('لا توجد نظرية تغيير / إطار أثر', 'No Theory of Change / impact framework'),
    l('دون نظرية تغيير لا يمكن ربط المخرجات بالنتائج والأثر ولا تقييم قوة الأدلة.', 'Without a Theory of Change, outputs cannot be linked to outcomes and impact, nor evidence strength assessed.'),
    l('أنشئ إطار الأثر من قالب المسار وأكمل سلسلة النتائج.', 'Create the impact framework from the track template and complete the results chain.'), {}, pid, 'impact'));
  else if (chain.gaps.length) out.push(mk('IMPACT_CHAIN_GAPS', 'gap', chain.score < 60 ? 'high' : 'medium', 'measurement',
    l('سلسلة النتائج غير مكتملة', 'Results chain incomplete'),
    l(`اكتمال السلسلة ${chain.score}%: ${chain.gaps.slice(0, 4).map((g) => g.label.ar).join('؛ ')}.`, `Chain completeness ${chain.score}%: ${chain.gaps.slice(0, 4).map((g) => g.label.en).join('; ')}.`),
    l('أكمل العناصر الناقصة في إطار الأثر والمؤشرات.', 'Complete the missing framework elements and indicators.'), { score: chain.score, gaps: chain.gaps.map((g) => g.key) }, pid, 'impact'));
  if (b.impactFramework && b.indicators.filter((i) => i.indicator_type === 'outcome' || i.indicator_type === 'impact').length === 0)
    out.push(mk('IMPACT_ONLY_OUTPUTS', 'gap', 'high', 'measurement',
      l('القياس يقتصر على المخرجات', 'Measurement limited to outputs'),
      l('لا توجد مؤشرات نتائج أو أثر؛ ستقيس التقارير حجم التنفيذ فقط.', 'There are no outcome or impact indicators; reports will only show delivery volume.'),
      l('أضف مؤشرات نتائج/أثر من مؤشرات المسار المقترحة.', 'Add outcome/impact indicators from the track defaults.'), {}, pid, 'impact'));

  const indicatorPerf = b.indicators.filter((i) => i.status === 'active').map((i) => ({ i, perf: indicatorPerformance(i, b.measurements, share) }));
  for (const { i, perf } of indicatorPerf) {
    if (perf.status === 'off_track') out.push(mk('KPI_OFF_TRACK', 'risk', i.indicator_type === 'outcome' || i.indicator_type === 'impact' ? 'high' : 'medium', 'measurement',
      l(`المؤشر ${i.code} خارج المسار`, `Indicator ${i.code} off track`),
      l(`«${i.name}»: آخر قيمة ${perf.latest} مقابل مستهدف ${perf.target} (تقدم ${perf.progress_pct ?? '—'}% مع مرور ${share === null ? '—' : Math.round(share * 100)}% من المدة).`,
        `“${i.name_en ?? i.name}”: latest ${perf.latest} vs target ${perf.target} (progress ${perf.progress_pct ?? '—'}% with ${share === null ? '—' : Math.round(share * 100)}% elapsed).`),
      l('حلل أسباب الانحراف وحدّث خطة التنفيذ أو المستهدف بمبرر موثق.', 'Analyze the deviation and adjust delivery or the target with documented justification.'), { indicator_id: i.id, ...perf }, pid, 'impact', i.id));
    for (const a of perf.anomalies) out.push(mk('KPI_ANOMALY', 'kpi_anomaly', 'medium', 'measurement',
      l(`قيمة غير معتادة في المؤشر ${i.code}`, `Anomaly in indicator ${i.code}`), a,
      l('تحقق من صحة البيانات ومصدرها قبل استخدامها في التقارير.', 'Verify the data and its source before reporting.'), { indicator_id: i.id }, pid, 'impact', `${i.id}:${a.en.slice(0, 24)}`));
    if (started && perf.measurements === 0 && i.indicator_type !== 'impact' && (i.measurement_points.includes('T0') || i.baseline_value === null))
      out.push(mk('KPI_NO_DATA', 'evidence_gap', 'medium', 'measurement',
        l(`لا توجد قياسات للمؤشر ${i.code}`, `No measurements for ${i.code}`),
        l(`«${i.name}» بلا أي قياس رغم بدء البرنامج${i.baseline_value === null ? ' ودون خط أساس' : ''}.`, `“${i.name_en ?? i.name}” has no measurements although the program started${i.baseline_value === null ? ', and no baseline' : ''}.`),
        l('سجّل قياس T0 أو خط الأساس فورًا.', 'Record the T0 / baseline measurement now.'), { indicator_id: i.id }, pid, 'impact', i.id));
    if (i.indicator_type === 'outcome' || i.indicator_type === 'impact') {
      const claim = assessClaim(i, b.measurements, b.evidence, b.impactFramework);
      if (claim.level === 'observed_change') out.push(mk('CLAIM_OBSERVED_ONLY', 'interpretation', 'info', 'measurement',
        l(`نتيجة ${i.code}: تغير مُلاحظ فقط`, `${i.code}: observed change only`), claim.explanation,
        claim.requirements_for_next_level[0] ?? l('عزّز الأدلة.', 'Strengthen evidence.'), { indicator_id: i.id, level: claim.level, observed_change: claim.observed_change }, pid, 'impact', i.id));
    }
  }
  const outputsDone = b.outputs.filter((o) => o.status === 'achieved').length;
  const outcomeMeasured = b.measurements.some((m) => b.indicators.find((i) => i.id === m.indicator_id && (i.indicator_type === 'outcome' || i.indicator_type === 'impact')))
    || b.outcomes.some((o) => o.actual !== null);
  if (outputsDone > 0 && !outcomeMeasured) out.push(mk('OUTPUT_WITHOUT_OUTCOME', 'gap', 'medium', 'measurement',
    l('مخرجات منجزة دون قياس نتائج', 'Outputs achieved without outcome measurement'),
    l(`${outputsDone} مخرجات منجزة، ولا توجد أي قياسات للنتائج؛ حجم التنفيذ لا يعني تحقق النتائج.`, `${outputsDone} outputs achieved but no outcome measurements; delivery volume is not evidence of outcomes.`),
    l('خطط قياس النتائج عند T1 وما بعدها.', 'Plan outcome measurement at T1 and beyond.'), { outputs_achieved: outputsDone }, pid, 'outcomes'));
  for (const o of b.outputs) if (o.due_date && o.due_date < todayStr && !['achieved', 'not_achieved', 'partially_achieved'].includes(o.status))
    out.push(mk('OUTPUT_OVERDUE', 'risk', 'low', 'delivery', l(`المخرج ${o.code} تجاوز موعده`, `Output ${o.code} overdue`),
      l(`${o.description}: الفعلي ${o.actual} من ${o.target ?? '—'} ${o.unit}.`, `${o.description}: actual ${o.actual} of ${o.target ?? '—'} ${o.unit}.`),
      l('حدّث الحالة أو الخطة.', 'Update status or plan.'), { output_id: o.id }, pid, 'outcomes', o.id));

  // Maturity measurement points
  const fw = b.maturityFrameworks[0];
  const trackHasMaturity = !!track && track.maturity_dimensions.length > 0;
  if (!fw && trackHasMaturity && isActive) out.push(mk('MATURITY_NO_FRAMEWORK', 'missing_config', 'medium', 'measurement',
    l('لا يوجد إطار نضج مرتبط بالبرنامج', 'No maturity framework linked'),
    l('بدون إطار نضج لا يمكن مقارنة T0 وT1 وقياس التحسن حسب الأبعاد.', 'Without a maturity framework, T0/T1 comparison by dimension is impossible.'),
    l('أنشئ إطار النضج من قالب المسار.', 'Create the maturity framework from the track template.'), {}, pid, 'assessments'));
  if (fw && started) {
    const due = duePoints(p.end_date, today);
    const subjects = b.enrollments.filter((e) => !['withdrawn', 'dropped'].includes(e.status)).map((e) => e.beneficiary_id);
    for (const point of due) {
      const have = new Set(b.maturityAssessments.filter((a) => a.framework_id === fw.id && a.measurement_point === point).map((a) => a.beneficiary_id));
      const missing = subjects.filter((s) => !have.has(s));
      if (subjects.length && missing.length) {
        const sev: Severity = point === 'T0' ? 'high' : point === 'T1' ? 'high' : 'medium';
        out.push(mk(`MATURITY_${point}_MISSING`, 'evidence_gap', sev, 'measurement',
          l(`قياس ${point} ناقص لـ ${missing.length} مستفيد`, `${point} measurement missing for ${missing.length} beneficiaries`),
          l(point === 'T0' ? 'غياب خط الأساس يمنع أي مقارنة قبل/بعد لاحقًا.' : `حان موعد ${point} ولم يُقَس ${missing.length} من ${subjects.length}.`,
            point === 'T0' ? 'Without a baseline, no before/after comparison will be possible.' : `${point} is due and ${missing.length} of ${subjects.length} are unmeasured.`),
          l(`سجّل قياس ${point} للمستفيدين المتبقين.`, `Record ${point} for the remaining beneficiaries.`), { point, missing: missing.length, total: subjects.length }, pid, 'assessments', point));
      }
    }
  }

  // ------------------------------------------------------------ evidence
  const ev = evidenceCompleteness(b);
  if (ev.missing.length) out.push(mk('EVIDENCE_GAPS', 'evidence_gap', ev.score < 50 ? 'high' : 'medium', 'evidence',
    l('فجوات في الأدلة المطلوبة', 'Required evidence gaps'),
    l(`اكتمال الأدلة ${ev.score}%: ${ev.missing.slice(0, 4).map((m) => m.label.ar).join('؛ ')}.`, `Evidence completeness ${ev.score}%: ${ev.missing.slice(0, 4).map((m) => m.label.en).join('; ')}.`),
    l('ارفع الأدلة الناقصة واربطها بالمرحلة أو المؤشر.', 'Upload the missing evidence and link it to the stage or indicator.'), { score: ev.score, missing: ev.missing.map((m) => m.key) }, pid, 'evidence'));
  const stalePending = b.evidence.filter((e) => e.verification_status === 'pending' && daysBetween(e.created_at.slice(0, 10), todayStr) > 14);
  if (stalePending.length) out.push(mk('EVIDENCE_BACKLOG', 'data_quality', stalePending.length > 10 ? 'medium' : 'low', 'evidence',
    l('أدلة بانتظار التحقق منذ أكثر من 14 يومًا', 'Evidence awaiting verification > 14 days'),
    l(`${stalePending.length} دليل غير متحقق منه؛ لا يُحتسب كدليل موثق في التقارير.`, `${stalePending.length} items unverified; they will not count as verified evidence in reports.`),
    l('وزّع مهام التحقق على مسؤولي الجودة.', 'Assign verification to quality officers.'), { count: stalePending.length }, pid, 'evidence'));
  const rejected = b.evidence.filter((e) => e.verification_status === 'rejected' || e.verification_status === 'needs_info');
  if (rejected.length) out.push(mk('EVIDENCE_REJECTED', 'evidence_gap', 'low', 'evidence',
    l('أدلة مرفوضة أو تحتاج معلومات', 'Evidence rejected or needing info'),
    l(`${rejected.length} دليل يحتاج استبدالًا أو استكمالًا.`, `${rejected.length} items need replacement or completion.`),
    l('استبدل الأدلة المرفوضة.', 'Replace rejected evidence.'), { count: rejected.length }, pid, 'evidence'));

  // ------------------------------------------------------------ finance
  const planned = b.budgets.reduce((a, x) => a + Number(x.planned_amount), 0);
  const actual = b.budgets.reduce((a, x) => a + Number(x.actual_amount), 0);
  const committed = b.budgets.reduce((a, x) => a + Number(x.committed_amount), 0);
  if (p.budget_total && !b.budgets.length) out.push(mk('BUDGET_NO_LINES', 'missing_config', 'low', 'finance',
    l('لا توجد بنود ميزانية', 'No budget lines'),
    l(`إجمالي الميزانية ${p.budget_total} دون توزيع على بنود.`, `Total budget ${p.budget_total} is not broken down into lines.`),
    l('أضف بنود الميزانية.', 'Add budget lines.'), {}, pid, 'finance'));
  if (p.budget_total && planned && Math.abs(planned - p.budget_total) > p.budget_total * 0.02) out.push(mk('BUDGET_MISMATCH', 'inconsistency', 'medium', 'finance',
    l('بنود الميزانية لا تطابق الإجمالي', 'Budget lines do not match total'),
    l(`مجموع البنود ${planned} مقابل إجمالي ${p.budget_total}.`, `Lines total ${planned} vs program total ${p.budget_total}.`),
    l('وحّد الإجمالي مع البنود.', 'Reconcile total and lines.'), { planned, total: p.budget_total }, pid, 'finance'));
  if (planned && actual > planned) out.push(mk('BUDGET_OVERRUN', 'risk', 'high', 'finance',
    l('تجاوز الصرف للميزانية', 'Spending exceeds budget'),
    l(`الصرف الفعلي ${actual} مقابل مخطط ${planned} (${roundTo((actual / planned) * 100, 1)}%).`, `Actual ${actual} vs planned ${planned} (${roundTo((actual / planned) * 100, 1)}%).`),
    l('اعتمد إعادة توزيع أو اطلب زيادة رسمية.', 'Approve reallocation or request a formal increase.'), { planned, actual }, pid, 'finance'));
  else if (planned && committed + actual > planned * 1.0001) out.push(mk('BUDGET_COMMITTED_OVER', 'risk', 'medium', 'finance',
    l('الالتزامات تتجاوز الميزانية', 'Commitments exceed budget'),
    l(`الملتزم + الفعلي = ${committed + actual} مقابل ${planned}.`, `Committed + actual = ${committed + actual} vs ${planned}.`),
    l('راجع العقود والالتزامات.', 'Review contracts and commitments.'), { planned, committed, actual }, pid, 'finance'));
  if (planned && share !== null && share > 0.2 && actual / planned > share + 0.25) out.push(mk('BUDGET_BURN', 'risk', 'medium', 'finance',
    l('معدل الصرف أسرع من الزمن', 'Burn rate ahead of schedule'),
    l(`صُرف ${Math.round((actual / planned) * 100)}% مع مرور ${Math.round(share * 100)}% من المدة.`, `${Math.round((actual / planned) * 100)}% spent with ${Math.round(share * 100)}% of time elapsed.`),
    l('راجع خطة الصرف المتبقية.', 'Review the remaining spend plan.'), { planned, actual, elapsed: share }, pid, 'finance'));

  // ------------------------------------------------------------ risk & actions
  for (const r of b.risks.filter((x) => x.status !== 'closed')) {
    if (r.severity >= 15 && !r.mitigation?.trim()) out.push(mk('RISK_NO_MITIGATION', 'risk', 'high', 'risk',
      l(`خطر مرتفع دون خطة معالجة: ${r.title}`, `High risk without mitigation: ${r.title}`),
      l(`درجة الخطورة ${r.severity}/25.`, `Severity ${r.severity}/25.`),
      l('أضف خطة معالجة ومالكًا وموعدًا.', 'Add mitigation, owner and due date.'), { risk_id: r.id }, pid, 'overview', r.id));
    if (r.due_date && r.due_date < todayStr) out.push(mk('RISK_OVERDUE', 'risk', 'low', 'risk',
      l(`موعد معالجة متأخر: ${r.title}`, `Overdue risk treatment: ${r.title}`), l(`كان الموعد ${r.due_date}.`, `Due ${r.due_date}.`),
      l('حدّث حالة المعالجة.', 'Update the treatment status.'), { risk_id: r.id }, pid, 'overview', r.id));
  }
  const overdueActions = b.actions.filter((a) => ['open', 'in_progress'].includes(a.status) && a.due_date && a.due_date < todayStr);
  if (overdueActions.length) out.push(mk('ACTIONS_OVERDUE', 'risk', overdueActions.length > 5 ? 'medium' : 'low', 'delivery',
    l('إجراءات متأخرة', 'Overdue actions'), l(`${overdueActions.length} إجراء تجاوز موعده.`, `${overdueActions.length} actions are past due.`),
    l('تابع المسؤولين أو أعد جدولة الإجراءات.', 'Follow up owners or reschedule.'), { actions: overdueActions.map((a) => a.code).slice(0, 20) }, pid, 'delivery'));

  // ------------------------------------------------------------ data quality: duplicate beneficiaries
  const dupKeys = new Map<string, string[]>();
  for (const bn of b.beneficiaries) for (const key of [bn.national_id, bn.email?.toLowerCase(), bn.mobile?.replace(/\D/g, '')].filter(Boolean) as string[]) {
    const arr = dupKeys.get(key) ?? []; arr.push(bn.id); dupKeys.set(key, arr);
  }
  const dups = [...dupKeys.values()].filter((v) => new Set(v).size > 1);
  if (dups.length) out.push(mk('DUPLICATE_BENEFICIARIES', 'overlap', 'medium', 'people',
    l('سجلات مستفيدين مكررة محتملة', 'Possible duplicate beneficiaries'),
    l(`${dups.length} مجموعة سجلات تتشارك الهوية أو البريد أو الجوال؛ قد تتضخم الأعداد.`, `${dups.length} record groups share ID, email or mobile; counts may be inflated.`),
    l('ادمج أو صحح السجلات المكررة.', 'Merge or correct duplicates.'), { groups: dups.slice(0, 10) }, pid, 'participants'));

  // ------------------------------------------------------------ score
  out.sort((a, b2) => SEVERITY_ORDER[b2.severity] - SEVERITY_ORDER[a.severity]);
  const penalty = out.reduce((a, i) => a + SEVERITY_WEIGHT[i.severity], 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty * 0.6)));
  const areas = (['setup', 'delivery', 'measurement', 'evidence', 'finance', 'risk', 'people'] as HealthArea[]).reduce((acc, a) => {
    const pen = out.filter((i) => i.area === a).reduce((s, i) => s + SEVERITY_WEIGHT[i.severity], 0);
    acc[a] = Math.max(0, 100 - pen * 2); return acc;
  }, {} as Record<HealthArea, number>);
  const grade: HealthReport['grade'] = out.some((i) => i.severity === 'critical') || score < 40 ? 'critical' : score < 60 ? 'at_risk' : score < 80 ? 'watch' : 'good';

  return {
    score, grade, areas, insights: out,
    next_actions: out.filter((i) => i.severity !== 'info').slice(0, 5),
    metrics: {
      enrolled, target: p.target_beneficiaries, attendance_rate: attendanceRate,
      stages_completed: doneStages, stages_total: b.stages.length,
      sessions_completed: completed.length, sessions_upcoming: upcoming.length,
      evidence_completeness: ev.score, chain_completeness: chain.score,
      budget_planned: planned, budget_actual: actual, elapsed_pct: share === null ? null : Math.round(share * 100),
    },
    generated_at: today.toISOString(),
  };
}
