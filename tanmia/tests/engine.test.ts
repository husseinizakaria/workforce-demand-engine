import { describe, expect, it } from 'vitest';
import fixture from '../supabase/tests/fixtures/scoring.json';
import {
  DEFAULT_BANDS, TRACKS, assessClaim, compareMaturity, detectBatchConflicts, detectConflicts, duePoints, evidenceCompleteness,
  generateSlots, indicatorPerformance, isFieldVisible, matchExperts, maturityOverall, normalizeText, programHealth, buildReport,
  answerQuestion, classifyQuestion, resultsChainCompleteness, riyadhParts, scoreFormAnswers, scoreResult,
  type IndicatorLike, type MeasurementLike, type ExpertLike, type ImpactFrameworkLike, type QuestionLike, type ToolLike,
} from '../supabase/functions/_shared/engine/index.ts';
import { bundle } from './helpers.ts';

describe('assessment scoring (parity with SQL trigger fixture)', () => {
  const tool: ToolLike = { ...(fixture.tool as Omit<ToolLike, 'classification'> & { scoring_method: 'weighted_average' }), classification: DEFAULT_BANDS };
  const dims = fixture.dimensions.map((d) => ({ id: d.code, weight: d.weight }));
  const questions: QuestionLike[] = fixture.questions.map((q) => ({ id: q.code, dimension_id: q.dimension, question_type: q.question_type as QuestionLike['question_type'],
    options: q.options, weight: q.weight, reverse_scored: q.reverse_scored }));

  it('scores responses exactly like the database trigger', () => {
    const r = scoreResult(tool, dims, questions, { responses: fixture.responses as unknown as Record<string, never> });
    expect(r.dimension_scores.D1).toBe(fixture.expected.D1);
    expect(r.dimension_scores.D2).toBe(fixture.expected.D2);
    expect(r.total_score).toBe(fixture.expected.total_score);
    expect(r.normalized_score).toBe(fixture.expected.normalized_score);
    expect(r.classification?.label_en).toBe(fixture.expected.label_en);
    expect(r.passed).toBe(fixture.expected.passed);
  });
  it('sum method over imported dimension scores', () => {
    const r = scoreResult({ ...tool, scoring_method: 'sum' }, dims, questions, { dimension_scores: fixture.sum_case.dimension_scores });
    expect(r.total_score).toBe(fixture.sum_case.expected.total_score);
    expect(r.normalized_score).toBe(fixture.sum_case.expected.normalized_score);
  });
  it('no scored dimensions gives null totals', () => {
    expect(scoreResult(tool, dims, questions, {}).total_score).toBeNull();
  });
  it('form scoring and conditional logic', () => {
    const fields = [
      { key: 'a', type: 'rating', scoring: { weight: 2 } },
      { key: 'b', type: 'single_choice', options: [{ value: 'x', score: 3 }] },
      { key: 'c', type: 'text' },
    ];
    expect(scoreFormAnswers(fields, { a: 4, b: 'x', c: 'hi' }, true)).toBe(11);
    expect(scoreFormAnswers(fields, { a: 4 }, false)).toBeNull();
    expect(isFieldVisible({ field: 'emp', op: 'eq', value: 'yes' }, { emp: 'yes' })).toBe(true);
    expect(isFieldVisible({ field: 'emp', op: 'eq', value: 'yes' }, { emp: 'no' })).toBe(false);
  });
});

describe('maturity', () => {
  const fw = { id: 'f', name: 'F', scale_min: 1, scale_max: 5, weighted: true, dimensions: [
    { key: 'a', name_ar: 'أ', name_en: 'A', weight: 2 }, { key: 'b', name_ar: 'ب', name_en: 'B', weight: 1 }] };
  it('weighted overall mirrors SQL', () => {
    expect(maturityOverall(fw, { a: 4, b: 1 })).toEqual({ score: 3, level: 3 });
  });
  it('compares T0/T1 paired subjects and never claims causality', () => {
    const rows = ['x', 'y', 'z'].flatMap((s, i) => [
      { framework_id: 'f', beneficiary_id: s, team_id: null, measurement_point: 'T0', dimension_scores: { a: 2, b: 2 }, overall_score: null, data_quality: 'assessor_rated' },
      ...(i < 2 ? [{ framework_id: 'f', beneficiary_id: s, team_id: null, measurement_point: 'T1', dimension_scores: { a: 4, b: 3 }, overall_score: null, data_quality: 'verified' }] : []),
    ]);
    const c = compareMaturity(fw, rows, 'T0', 'T1');
    expect(c.paired).toBe(2);
    expect(c.missing_follow_up).toBe(1);
    expect(c.overall_change).toBeCloseTo(1.67, 2);
    expect(c.improved).toBe(2);
    expect(c.confidence).toBe('insufficient');
    expect(c.interpretation.some((x) => /does not prove/.test(x.en))).toBe(true);
  });
  it('due measurement points follow program end date', () => {
    expect(duePoints('2026-01-01', new Date('2026-04-15T00:00:00Z'))).toEqual(['T0', 'T1', 'T2', 'T3']);
    expect(duePoints(null)).toEqual(['T0']);
  });
});

describe('impact claims', () => {
  const ind: IndicatorLike = { id: 'i', code: 'KPI-1', name: 'Readiness', indicator_type: 'outcome', chain_level: 'outcome', unit: 'score',
    baseline_value: null, target_value: 4, direction: 'increase', data_source: 'x', measurement_points: ['T0', 'T1'], evidence_required: true, status: 'active' };
  const m = (point: string, value: number, comparison: number | null = null, evidence_id: string | null = null): MeasurementLike =>
    ({ id: point, indicator_id: 'i', measurement_point: point, value, comparison_value: comparison, sample_size: 30, data_quality: 'reported', evidence_id, measured_at: '2026-01-01' });
  const fw = (design: ImpactFrameworkLike['evaluation_design'], status = 'approved'): ImpactFrameworkLike => ({ id: 'f', problem_statement: 'p', target_population: 't', baseline_summary: 'b',
    theory_of_change: { assumptions: ['a'] }, intended_impact: 'x', evaluation_design: design, attribution_approach: 'contribution', status });

  it('pre/post alone is only observed change', () => {
    const c = assessClaim(ind, [m('T0', 2), m('T1', 3)], [], fw('pre_post', 'draft'));
    expect(c.level).toBe('observed_change');
    expect(c.observed_change).toBe(1);
    expect(c.allowed_statement.en).toMatch(/cannot be attributed/);
  });
  it('approved ToC + verified evidence → contribution, still not causal', () => {
    const c = assessClaim(ind, [m('T0', 2), m('T1', 3, null, 'e1')], [{ id: 'e1', code: 'E', title: 'E', evidence_type: 'dataset', verification_status: 'verified', stage_key: null, indicator_id: 'i', beneficiary_id: null, session_id: null, outcome_id: null, output_id: null, file_path: 'x', source_url: null, created_at: '2026-01-01' }], fw('pre_post'));
    expect(c.level).toBe('contribution');
  });
  it('comparison group with diff-in-diff → stronger causal evidence', () => {
    const c = assessClaim(ind, [m('T0', 2, 2), m('T1', 3.5, 2.5)], [], fw('comparison_group'));
    expect(c.level).toBe('stronger_causal');
    expect(c.difference_in_differences).toBe(1);
  });
  it('output indicators never reach outcome claims', () => {
    expect(assessClaim({ ...ind, indicator_type: 'output' }, [m('T1', 40)], [], fw('rct')).level).toBe('activity_only');
  });
  it('indicator performance status and anomalies', () => {
    const perf = indicatorPerformance({ ...ind, unit: 'percent', target_value: 80, baseline_value: 20 }, [m('T0', 20), m('T1', 150)], 1);
    expect(perf.anomalies.length).toBeGreaterThan(0);
    const p2 = indicatorPerformance({ ...ind, baseline_value: 2 }, [m('T1', 2.2)], 0.9);
    expect(p2.status).toBe('off_track');
  });
  it('results chain completeness flags missing framework', () => {
    expect(resultsChainCompleteness(null, []).gaps.some((g) => g.key === 'framework')).toBe(true);
  });
});

describe('scheduling', () => {
  const sessions = [{ id: 's1', code: 'SES-1', title: 'Busy', program_id: 'p', expert_id: 'e1', starts_at: '2026-03-01T07:00:00Z', ends_at: '2026-03-01T09:00:00Z', status: 'scheduled', session_type: 'training', location: 'Hall A', delivery_mode: 'onsite' }];
  const ctx = { sessions, participants: [{ session_id: 's1', beneficiary_id: 'b1', attendance_status: 'unknown' }], availability: [], experts: [] };
  it('detects expert, beneficiary and location overlaps', () => {
    const types = detectConflicts({ starts_at: '2026-03-01T08:00:00Z', ends_at: '2026-03-01T10:00:00Z', expert_id: 'e1', beneficiary_ids: ['b1'], location: 'hall a' }, ctx).map((c) => c.type);
    expect(types).toEqual(expect.arrayContaining(['expert_overlap', 'beneficiary_overlap', 'location_overlap']));
  });
  it('adjacent sessions do not conflict', () => {
    expect(detectConflicts({ starts_at: '2026-03-01T09:00:00Z', ends_at: '2026-03-01T10:00:00Z', expert_id: 'e1' }, ctx)).toEqual([]);
  });
  it('riyadh wall clock is UTC+3', () => {
    expect(riyadhParts('2026-03-01T21:30:00Z')).toEqual({ date: '2026-03-02', weekday: 1, minutes: 30 });
  });
  it('generates recurring slots in Riyadh time and flags batch overlaps', () => {
    const slots = generateSlots({ start_date: '2026-03-01', count: 4, weekdays: [0, 2], start_time: '10:00', duration_minutes: 90 });
    expect(slots).toHaveLength(4);
    expect(slots[0].starts_at).toBe('2026-03-01T07:00:00.000Z');
    const batch = detectBatchConflicts([{ ...slots[0], expert_id: 'e2' }, { ...slots[0], expert_id: 'e2' }], { ...ctx, sessions: [] });
    expect(batch[0].some((c) => c.type === 'batch_overlap')).toBe(true);
  });
});

describe('expert matching', () => {
  const ex = (id: string, o: Partial<ExpertLike>): ExpertLike => ({ id, code: id, full_name: id, roles: ['mentor'], expertise: [], sectors: [], languages: ['ar'], city: 'الرياض',
    delivery_modes: ['onsite'], rating: null, max_weekly_hours: 10, conflicts: [], status: 'active', ...o });
  it('ranks by explainable factors and excludes conflicts', () => {
    const r = matchExperts([
      ex('a', { expertise: ['التسويق الرقمي', 'المالية'], rating: 4.8 }),
      ex('b', { expertise: ['المالية'] }),
      ex('c', { expertise: ['التسويق الرقمي', 'المالية'], conflicts: ['شركة الراعي'] }),
    ], { role: 'mentor', expertise: ['تسويق رقمي', 'المالية'], conflict_terms: ['شركة الراعي'] }, { assignments: [], availability: [] });
    expect(r[0].expert_id).toBe('a');
    expect(r.find((x) => x.expert_id === 'c')!.eligible).toBe(false);
    expect(r[0].factors.find((f) => f.key === 'expertise')!.points).toBe(30);
  });
  it('normalizes Arabic text variants', () => {
    expect(normalizeText('الإدارة')).toBe(normalizeText('ادارة'));
  });
});

describe('program health (expert rules)', () => {
  const today = new Date('2026-07-01T00:00:00Z');
  it('detects missing setup, journey stall and missing T0 maturity', () => {
    const b = bundle({
      enrollments: [{ id: 'e', beneficiary_id: 'b1', cohort_id: null, status: 'active', progress: 0 }],
      maturityFrameworks: [{ id: 'f', name: 'F', scale_min: 1, scale_max: 5, weighted: true, dimensions: [{ key: 'a', name_ar: 'أ', name_en: 'A' }] }],
    });
    const h = programHealth(b, today);
    const codes = h.insights.map((i) => i.rule_code);
    expect(codes).toEqual(expect.arrayContaining(['IMPACT_NO_FRAMEWORK', 'JOURNEY_STALLED', 'MATURITY_T0_MISSING', 'CFG_NO_COHORT', 'EXPERTS_NONE']));
    expect(h.score).toBeLessThan(80);
    expect(h.next_actions.length).toBeGreaterThan(0);
    for (const i of h.insights) { expect(i.rationale.ar).toBeTruthy(); expect(i.recommended_action.en).toBeTruthy(); }
  });
  it('flags blocked stages and budget overrun', () => {
    const b = bundle({ budgets: [{ category: 'x', planned_amount: 100, committed_amount: 0, actual_amount: 150 }] });
    b.stages[0].status = 'blocked'; b.stages[0].blocker_note = 'No venue';
    const codes = programHealth(b, today).insights.map((i) => i.rule_code);
    expect(codes).toEqual(expect.arrayContaining(['STAGE_BLOCKED', 'BUDGET_OVERRUN']));
  });
  it('evidence completeness reflects stage requirements', () => {
    const b = bundle(); b.stages[0].status = 'completed';
    const ev = evidenceCompleteness(b);
    expect(ev.missing.some((m) => m.key.startsWith('stage:workforce_need'))).toBe(true);
  });
  it('builds a bilingual report and answers questions', () => {
    const r = buildReport('final_comprehensive', bundle(), { today });
    expect(r.sections.length).toBe(18);
    expect(r.sections.find((s) => s.key === 'impact')!.narrative.some((n) => /not proof of causal/.test(n.en))).toBe(true);
    expect(classifyQuestion('ما العوائق الحالية؟')).toBe('blockers');
    expect(answerQuestion('what should we do next?', bundle(), today).answer.length).toBeGreaterThan(0);
  });
});

describe('track definitions', () => {
  it('six tracks with valid, acyclic dependencies', () => {
    expect(TRACKS.map((t) => t.code).sort()).toEqual(['bootcamp', 'consulting', 'graduate', 'hackathon', 'incubator', 'vocational']);
    for (const t of TRACKS) {
      const seen = new Set<string>();
      for (const s of t.stages) {
        for (const d of s.depends_on) expect(seen.has(d), `${t.code}.${s.key} depends on ${d}`).toBe(true);
        seen.add(s.key);
      }
      expect(new Set(t.stages.map((s) => s.key)).size).toBe(t.stages.length);
    }
  });
});
