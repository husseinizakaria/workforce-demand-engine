// "Ask Platform" — deterministic question routing over the engine. Used when
// no LLM is configured, and to build grounded context when one is.
import { type L10n, type ProgramBundle, l } from './types.ts';
import { programHealth } from './health.ts';
import { compareMaturity } from './maturity.ts';
import { elapsedShare, indicatorPerformance } from './impact.ts';
import { evidenceCompleteness } from './evidence.ts';

export type Intent = 'health' | 'next_actions' | 'risks' | 'evidence' | 'attendance' | 'maturity' | 'impact' | 'budget' | 'experts' | 'blockers' | 'summary';

const PATTERNS: [Intent, RegExp][] = [
  ['blockers', /(عائق|عوائق|معوق|متوقف|توقف|block|stuck|stalled)/i],
  ['next_actions', /(الخطوة|التالي|ماذا (أ|ا)فعل|توصي|next|recommend|what should)/i],
  ['risks', /(خطر|مخاطر|risk|issue|قضية)/i],
  ['evidence', /(دليل|أدلة|ادلة|إثبات|evidence|proof)/i],
  ['attendance', /(حضور|غياب|attend|absen)/i],
  ['maturity', /(نضج|maturity|T0|T1|قبل|بعد|before|after)/i],
  ['impact', /(أثر|اثر|نتائج|مؤشر|impact|outcome|kpi|indicator)/i],
  ['budget', /(ميزانية|صرف|تكلفة|budget|spend|cost)/i],
  ['experts', /(خبير|خبراء|مرشد|محكم|expert|mentor|judge)/i],
  ['health', /(صحة|حالة|وضع|health|status|how is)/i],
];

export function classifyQuestion(q: string): Intent {
  for (const [intent, re] of PATTERNS) if (re.test(q)) return intent;
  return 'summary';
}

export interface Answer { intent: Intent; answer: L10n[]; sources: string[] }

export function answerQuestion(question: string, b: ProgramBundle, today = new Date()): Answer {
  const intent = classifyQuestion(question);
  const h = programHealth(b, today);
  const by = (codes: string[]) => h.insights.filter((i) => codes.some((c) => i.rule_code.startsWith(c)));
  const lines: L10n[] = [];
  const src: string[] = [];
  switch (intent) {
    case 'health':
    case 'summary':
      lines.push(l(`مؤشر صحة «${b.program.name}» = ${h.score}/100 (${h.grade}).`, `“${b.program.name}” health = ${h.score}/100 (${h.grade}).`));
      for (const [k, v] of Object.entries(h.areas)) if (v < 80) lines.push(l(`مجال ${k}: ${v}/100`, `${k}: ${v}/100`));
      lines.push(...h.next_actions.slice(0, 3).map((i) => l(`• ${i.title.ar} — ${i.recommended_action.ar}`, `• ${i.title.en} — ${i.recommended_action.en}`)));
      src.push('program_health'); break;
    case 'next_actions':
      if (!h.next_actions.length) lines.push(l('لا توجد إجراءات عاجلة؛ البرنامج في وضع جيد.', 'No urgent actions; the program is in good shape.'));
      lines.push(...h.next_actions.map((i, n) => l(`${n + 1}. ${i.recommended_action.ar} — السبب: ${i.rationale.ar}`, `${n + 1}. ${i.recommended_action.en} — because: ${i.rationale.en}`)));
      src.push('program_health.next_actions'); break;
    case 'blockers': {
      const bl = h.insights.filter((i) => i.kind === 'blocker');
      lines.push(bl.length ? l(`يوجد ${bl.length} عائق:`, `${bl.length} blocker(s):`) : l('لا توجد عوائق مسجلة في الرحلة.', 'No blockers recorded in the journey.'));
      lines.push(...bl.map((i) => l(`• ${i.title.ar}: ${i.rationale.ar}`, `• ${i.title.en}: ${i.rationale.en}`)));
      src.push('program_stages'); break;
    }
    case 'risks': {
      const open = b.risks.filter((r) => r.status !== 'closed').sort((a, c) => c.severity - a.severity);
      lines.push(l(`المخاطر المفتوحة: ${open.length} (عالية: ${open.filter((r) => r.severity >= 15).length}).`, `Open risks: ${open.length} (high: ${open.filter((r) => r.severity >= 15).length}).`));
      lines.push(...open.slice(0, 5).map((r) => l(`• ${r.code} ${r.title} — ${r.severity}/25`, `• ${r.code} ${r.title} — ${r.severity}/25`)));
      lines.push(...by(['RISK_', 'BUDGET_', 'OPS_LOW']).map((i) => l(`• ${i.title.ar}`, `• ${i.title.en}`)));
      src.push('risks_issues'); break;
    }
    case 'evidence': {
      const ev = evidenceCompleteness(b);
      lines.push(l(`اكتمال الأدلة ${ev.score}% (${ev.satisfied}/${ev.required} متطلبًا).`, `Evidence completeness ${ev.score}% (${ev.satisfied}/${ev.required} requirements).`));
      lines.push(...ev.missing.slice(0, 6).map((m) => l(`• ${m.label.ar}`, `• ${m.label.en}`)));
      src.push('evidence'); break;
    }
    case 'attendance': {
      const marked = b.participants.filter((x) => x.attendance_status !== 'unknown');
      const pres = marked.filter((x) => ['present', 'late'].includes(x.attendance_status)).length;
      lines.push(marked.length ? l(`نسبة الحضور ${Math.round((pres / marked.length) * 100)}% من ${marked.length} سجل.`, `Attendance ${Math.round((pres / marked.length) * 100)}% across ${marked.length} records.`)
        : l('لا توجد بيانات حضور.', 'No attendance data.'));
      lines.push(...by(['OPS_']).map((i) => l(`• ${i.title.ar}: ${i.rationale.ar}`, `• ${i.title.en}: ${i.rationale.en}`)));
      src.push('session_participants'); break;
    }
    case 'maturity': {
      const fw = b.maturityFrameworks[0];
      if (!fw) { lines.push(l('لا يوجد إطار نضج مرتبط.', 'No maturity framework linked.')); break; }
      const c = compareMaturity(fw, b.maturityAssessments, 'T0', 'T1');
      lines.push(...c.interpretation); src.push('maturity_assessments'); break;
    }
    case 'impact': {
      const share = elapsedShare(b.program.start_date, b.program.end_date, today);
      for (const i of b.indicators.filter((x) => x.status === 'active')) {
        const p = indicatorPerformance(i, b.measurements, share);
        lines.push(l(`• ${i.code} ${i.name}: ${p.latest ?? '—'} / ${p.target ?? '—'} (${p.status})`, `• ${i.code} ${i.name_en ?? i.name}: ${p.latest ?? '—'} / ${p.target ?? '—'} (${p.status})`));
      }
      if (!lines.length) lines.push(l('لا توجد مؤشرات نشطة.', 'No active indicators.'));
      lines.push(l('ملاحظة: التغير القبلي/البعدي تغير مُلاحظ وليس إثباتًا سببيًا.', 'Note: pre/post change is observed change, not causal proof.'));
      src.push('indicators', 'indicator_measurements'); break;
    }
    case 'budget': {
      const planned = b.budgets.reduce((a, x) => a + Number(x.planned_amount), 0); const actual = b.budgets.reduce((a, x) => a + Number(x.actual_amount), 0);
      lines.push(l(`المخطط ${planned}، الفعلي ${actual}${planned ? ` (${Math.round((actual / planned) * 100)}%)` : ''}.`, `Planned ${planned}, actual ${actual}${planned ? ` (${Math.round((actual / planned) * 100)}%)` : ''}.`));
      lines.push(...by(['BUDGET_']).map((i) => l(`• ${i.title.ar}`, `• ${i.title.en}`)));
      src.push('program_budgets'); break;
    }
    case 'experts': {
      const act = b.assignments.filter((a) => ['proposed', 'confirmed', 'active'].includes(a.status));
      lines.push(l(`الخبراء المُسندون: ${new Set(act.map((a) => a.expert_id)).size} في ${act.length} تكليف.`, `Assigned experts: ${new Set(act.map((a) => a.expert_id)).size} across ${act.length} assignments.`));
      lines.push(...by(['EXPERT', 'JUDGES']).map((i) => l(`• ${i.title.ar}`, `• ${i.title.en}`)));
      src.push('expert_assignments'); break;
    }
  }
  return { intent, answer: lines, sources: src };
}
