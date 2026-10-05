// ai-program-analysis — programs.view on the organization.
//   mode 'analyze' → programHealth (+ optional persisted insights, + LLM narrative)
//   mode 'ask'     → answerQuestion over one program or the org's active programs
//   mode 'status'  → whether the LLM is configured
import { serve, readJson, check } from '../_shared/http.ts';
import { getCaller, requirePermission } from '../_shared/auth.ts';
import { bool, enumOf, object, optional, parse, string, uuid, withDefault } from '../_shared/validate.ts';
import { audit } from '../_shared/audit.ts';
import { loadProgramBundle } from '../_shared/bundle.ts';
import { persistInsights } from '../_shared/insights.ts';
import { type Answer, type HealthReport, type L10n, answerQuestion, classifyQuestion, programHealth } from '../_shared/engine/index.ts';
import { draftNarrative, llmConfigured, llmModel } from '../_shared/llm.ts';

const Mode = object({ mode: enumOf(['analyze', 'ask', 'status'] as const) });
const AnalyzeBody = object({
  organization_id: uuid(),
  program_id: uuid(),
  persist: optional(bool()),
  locale: withDefault(enumOf(['ar', 'en'] as const), 'ar'),
});
const AskBody = object({
  organization_id: uuid(),
  program_id: optional(uuid()),
  question: string({ min: 1, max: 1000 }),
  locale: withDefault(enumOf(['ar', 'en'] as const), 'ar'),
});

function healthFacts(h: HealthReport, program: { code: string; name: string; status: string; start_date: string | null; end_date: string | null }) {
  return {
    program,
    health_score: h.score,
    grade: h.grade,
    area_scores: h.areas,
    metrics: h.metrics,
    insights: h.insights.slice(0, 30).map((i) => ({ severity: i.severity, area: i.area, title: i.title, rationale: i.rationale, recommended_action: i.recommended_action })),
    insights_total: h.insights.length,
    next_actions: h.next_actions.map((i) => i.recommended_action),
  };
}

serve(async (req) => {
  const caller = await getCaller(req);
  const raw = await readJson(req);
  const { mode } = parse(Mode, raw);

  if (mode === 'status') return { llm: llmConfigured(), model: llmConfigured() ? llmModel() : null };

  if (mode === 'analyze') {
    const b = parse(AnalyzeBody, raw);
    await requirePermission(caller, b.organization_id, 'programs.view');
    const bundle = await loadProgramBundle(caller.admin, b.organization_id, b.program_id);
    const health = programHealth(bundle);
    let persisted: { created: number; resolved: number; open: number } | null = null;
    if (b.persist) {
      const r = await persistInsights(caller.admin, b.organization_id, b.program_id, health.insights);
      persisted = { created: r.created.length, resolved: r.resolved, open: r.open };
      await audit(caller.admin, { organization_id: b.organization_id, actor_user_id: caller.userId, action: 'insights_persisted', entity_type: 'programs',
        entity_id: b.program_id, summary: `score ${health.score}`, new_data: persisted });
    }
    const llm = await draftNarrative({
      task: 'Write a short program health briefing (2-3 paragraphs): overall status, the most important issues with their rationale, and the recommended next steps.',
      facts: healthFacts(health, bundle.program),
      locale: b.locale,
      effort: 'low',
    });
    return { health, narrative: llm.text, generated_by: llm.text ? 'rules+llm' : 'rules', model: llm.text ? llm.model : null, persisted };
  }

  // ---- ask -------------------------------------------------------------------
  const b = parse(AskBody, raw);
  await requirePermission(caller, b.organization_id, 'programs.view');
  let answer: Answer;
  let facts: unknown;
  if (b.program_id) {
    const bundle = await loadProgramBundle(caller.admin, b.organization_id, b.program_id);
    answer = answerQuestion(b.question, bundle);
    const health = programHealth(bundle);
    facts = { question: b.question, rule_based_answer: answer, program_health: healthFacts(health, bundle.program) };
  } else {
    // Organization-level: summarise the active programs.
    const programs = check(await caller.admin.from('programs').select('id, name, code, status').eq('organization_id', b.organization_id)
      .in('status', ['active', 'planning']).order('updated_at', { ascending: false }).limit(8), 'programs') as { id: string; name: string; code: string; status: string }[];
    const lines: L10n[] = [];
    const perProgram: unknown[] = [];
    for (const p of programs) {
      const bundle = await loadProgramBundle(caller.admin, b.organization_id, p.id);
      const h = programHealth(bundle);
      const a = answerQuestion(b.question, bundle);
      lines.push({
        ar: `• ${p.name}: صحة ${h.score}/100 — ${h.next_actions[0]?.title.ar ?? 'لا ملاحظات عاجلة'}`,
        en: `• ${p.name}: health ${h.score}/100 — ${h.next_actions[0]?.title.en ?? 'no urgent findings'}`,
      });
      perProgram.push({ program: { code: p.code, name: p.name, status: p.status }, health_score: h.score, grade: h.grade, answer: a.answer.slice(0, 6) });
    }
    if (!programs.length) lines.push({ ar: 'لا توجد برامج نشطة أو قيد التخطيط.', en: 'There are no active or planning programs.' });
    answer = { intent: classifyQuestion(b.question), answer: lines, sources: ['programs', 'health'] };
    facts = { question: b.question, programs: perProgram };
  }
  const llm = await draftNarrative({
    task: 'Answer the user question in 1-3 short paragraphs using only the facts. If the facts do not answer it, say what data is missing.',
    facts,
    locale: b.locale,
    effort: 'low',
  });
  return { answer, narrative: llm.text, generated_by: llm.text ? 'rules+llm' : 'rules', model: llm.text ? llm.model : null };
});
