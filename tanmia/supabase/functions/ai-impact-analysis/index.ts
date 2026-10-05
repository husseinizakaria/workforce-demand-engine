// ai-impact-analysis — impact.view on the organization.
// Results chain completeness, indicator performance + claim level (observed
// change / contribution / stronger causal), maturity movement and evidence
// completeness, with an optional LLM narrative bound to the claim levels.
import { serve, readJson } from '../_shared/http.ts';
import { getCaller, requirePermission } from '../_shared/auth.ts';
import { enumOf, object, optional, parse, uuid, withDefault } from '../_shared/validate.ts';
import { loadProgramBundle } from '../_shared/bundle.ts';
import { assessClaim, compareMaturity, elapsedShare, evidenceCompleteness, indicatorPerformance, resultsChainCompleteness } from '../_shared/engine/index.ts';
import { draftNarrative } from '../_shared/llm.ts';

const POINT = enumOf(['T0', 'T1', 'T2', 'T3', 'T4', 'T5'] as const);
const Body = object({
  organization_id: uuid(),
  program_id: uuid(),
  compare_from: optional(POINT),
  compare_to: optional(POINT),
  locale: withDefault(enumOf(['ar', 'en'] as const), 'ar'),
});

serve(async (req) => {
  const caller = await getCaller(req);
  const b = parse(Body, await readJson(req));
  await requirePermission(caller, b.organization_id, 'impact.view');
  const bundle = await loadProgramBundle(caller.admin, b.organization_id, b.program_id);
  const from = b.compare_from ?? 'T0';
  const to = b.compare_to ?? 'T1';

  const chain = resultsChainCompleteness(bundle.impactFramework, bundle.indicators);
  const share = elapsedShare(bundle.program.start_date, bundle.program.end_date);
  const indicators = bundle.indicators.map((i) => ({
    indicator: {
      id: i.id, code: i.code, name: i.name, name_en: i.name_en ?? null, indicator_type: i.indicator_type, chain_level: i.chain_level, unit: i.unit,
      baseline_value: i.baseline_value, target_value: i.target_value, direction: i.direction, status: i.status,
    },
    performance: indicatorPerformance(i, bundle.measurements, share),
    claim: assessClaim(i, bundle.measurements, bundle.evidence, bundle.impactFramework),
  }));
  const maturity = bundle.maturityFrameworks.map((fw) => ({
    framework: { id: fw.id, name: fw.name },
    comparison: compareMaturity(fw, bundle.maturityAssessments, from, to),
  }));
  const evidence = evidenceCompleteness(bundle);

  const llm = await draftNarrative({
    task: 'Write an impact analysis briefing (3-4 short paragraphs): results-chain completeness, indicator progress, maturity movement and evidence strength. ' +
      'For every indicator use ONLY the wording allowed by its claim.level and claim.allowed_statement; never upgrade the claim level. End with what is needed to strengthen the evidence.',
    facts: {
      program: { code: bundle.program.code, name: bundle.program.name, status: bundle.program.status, start_date: bundle.program.start_date, end_date: bundle.program.end_date },
      evaluation_design: bundle.impactFramework?.evaluation_design ?? null,
      chain: { score: chain.score, gaps: chain.gaps.map((g) => g.label) },
      indicators: indicators.map((x) => ({
        code: x.indicator.code, name: x.indicator.name, type: x.indicator.indicator_type, unit: x.indicator.unit,
        baseline: x.performance.baseline, latest: x.performance.latest, target: x.performance.target, progress_pct: x.performance.progress_pct, status: x.performance.status,
        claim: { level: x.claim.level, label: x.claim.label, allowed_statement: x.claim.allowed_statement, observed_change: x.claim.observed_change, difference_in_differences: x.claim.difference_in_differences },
      })),
      maturity: maturity.map((m) => ({
        framework: m.framework.name, from: m.comparison.from, to: m.comparison.to, paired: m.comparison.paired, overall_before: m.comparison.overall_before,
        overall_after: m.comparison.overall_after, overall_change: m.comparison.overall_change, effect_size: m.comparison.effect_size, confidence: m.comparison.confidence,
        interpretation: m.comparison.interpretation,
      })),
      evidence: { score: evidence.score, required: evidence.required, satisfied: evidence.satisfied, verified_share: evidence.verified_share, missing: evidence.missing.map((m) => m.label) },
    },
    locale: b.locale,
    effort: 'low',
  });

  return { chain, indicators, maturity, evidence, narrative: llm.text, generated_by: llm.text ? 'rules+llm' : 'rules', model: llm.text ? llm.model : null };
});
