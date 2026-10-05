// generate-report — reports.create on the report's organization.
// Builds the report content with the engine (buildReport), optionally drafts
// an executive summary + recommendations with the LLM (grounded in the
// content only), and stores a new immutable report_versions row.
import { serve, readJson, fail, check } from '../_shared/http.ts';
import { getCaller, requirePermission } from '../_shared/auth.ts';
import { bool, object, optional, parse, record, string, uuid } from '../_shared/validate.ts';
import { audit } from '../_shared/audit.ts';
import { loadProgramBundle } from '../_shared/bundle.ts';
import { type ReportContent, type ReportType, REPORT_TYPES, buildReport } from '../_shared/engine/index.ts';
import { draftSections, llmConfigured, llmModel } from '../_shared/llm.ts';

const Body = object({
  report_id: uuid(),
  use_llm: optional(bool()),
  manual_text: optional(record(object({ ar: optional(string({ max: 20_000 })), en: optional(string({ max: 20_000 })) }), { maxKeys: 40 })),
});

const POINTS = new Set(['T0', 'T1', 'T2', 'T3', 'T4', 'T5']);

interface ReportRow {
  id: string; organization_id: string; program_id: string | null; report_type: string; title: string; period_start: string | null; period_end: string | null;
  configuration: Record<string, unknown> | null; status: string; current_version: number;
}

/** Facts given to the LLM: KPIs + rule-based narratives, tables summarised by size. */
function factsOf(content: ReportContent) {
  return {
    report_type: content.type,
    title: content.title,
    program: content.program,
    period: content.period,
    sections: content.sections.map((s) => ({
      key: s.key, title: s.title, narrative: s.narrative,
      kpis: s.kpis?.map((k) => ({ label: k.label, value: k.value })),
      tables: s.tables?.map((t) => ({ title: t.title, rows: t.table.rows.length, first_rows: t.table.rows.slice(0, 15), columns: t.table.columns })),
    })),
    data_notes: content.data_notes,
  };
}

serve(async (req) => {
  const caller = await getCaller(req);
  const b = parse(Body, await readJson(req));

  // Locate the report under the caller's own RLS scope (no existence leak), then authorize.
  const visible = check(await caller.userClient.from('reports').select('id, organization_id').eq('id', b.report_id).maybeSingle(), 'reports') as
    { id: string; organization_id: string } | null;
  if (!visible) fail('not_found', { detail: { entity: 'report' } });
  await requirePermission(caller, visible.organization_id, 'reports.create');
  const admin = caller.admin;
  const report = check(await admin.from('reports').select('*').eq('id', b.report_id).eq('organization_id', visible.organization_id).single(), 'reports') as ReportRow;
  if (!report.program_id) fail('program_required');
  if (!REPORT_TYPES.some((t) => t.key === report.report_type)) fail('invalid_input', { field: 'report_type' });

  const cfg = (report.configuration ?? {}) as Record<string, unknown>;
  const sections = Array.isArray(cfg.sections) ? (cfg.sections as unknown[]).filter((s): s is string => typeof s === 'string') : undefined;
  const points = (cfg.comparisons as { points?: unknown[] } | undefined)?.points?.filter((p): p is string => typeof p === 'string' && POINTS.has(p)) ?? [];
  const cfgManual = (cfg.manual_text && typeof cfg.manual_text === 'object' ? cfg.manual_text : {}) as Record<string, { ar?: string; en?: string }>;
  const manual_text = { ...cfgManual, ...(b.manual_text ?? {}) };

  const bundle = await loadProgramBundle(admin, report.organization_id, report.program_id);
  const content = buildReport(report.report_type as ReportType, bundle, {
    sections,
    period_start: report.period_start,
    period_end: report.period_end,
    detail_level: cfg.detail_level === 'detailed' ? 'detailed' : 'summary',
    manual_text,
    compare_from: points[0],
    compare_to: points[1],
  });

  // ---- optional LLM narrative ------------------------------------------------
  let narrative: Record<string, unknown> = {};
  let generator: 'rules' | 'rules+llm' = 'rules';
  const wantLlm = b.use_llm === true;
  if (wantLlm && llmConfigured()) {
    const facts = factsOf(content);
    const fields = {
      executive_summary: 'an executive summary of 2-4 short paragraphs',
      recommendations: '5-8 recommendation lines, each starting with "- ", derived from the report findings',
    };
    const task = 'Draft the executive summary and recommendations for this program report.';
    const [ar, en] = await Promise.all([
      draftSections({ task, facts, locale: 'ar', fields, effort: 'medium' }),
      draftSections({ task, facts, locale: 'en', fields, effort: 'medium' }),
    ]);
    if (ar.sections || en.sections) {
      generator = 'rules+llm';
      narrative = {
        draft: true,
        model: ar.model ?? en.model ?? llmModel(),
        generated_at: new Date().toISOString(),
        executive_summary: { ar: ar.sections?.executive_summary ?? null, en: en.sections?.executive_summary ?? null },
        recommendations: { ar: ar.sections?.recommendations ?? null, en: en.sections?.recommendations ?? null },
      };
    } else {
      narrative = { draft: true, error: ar.refused || en.refused ? 'refused' : (ar.error ?? en.error ?? 'unavailable') };
    }
  } else if (wantLlm) {
    narrative = { error: 'llm_not_configured' };
  }

  const version = (report.current_version ?? 0) + 1;
  const ins = await admin.from('report_versions').insert({
    organization_id: report.organization_id, report_id: report.id, version, content, narrative, generator, generated_by: caller.userId,
  }).select('id').single();
  if (ins.error?.code === '23505') fail('conflict', { detail: { reason: 'report generation already in progress' } });
  check(ins, 'report_versions');
  check(await admin.from('reports').update({ current_version: version, status: 'generated' })
    .eq('id', report.id).eq('organization_id', report.organization_id).eq('current_version', report.current_version), 'reports');

  await audit(admin, {
    organization_id: report.organization_id, actor_user_id: caller.userId, action: 'report_generated', entity_type: 'reports', entity_id: report.id,
    summary: `${report.title} v${version}`, new_data: { version, generator, sections: content.sections.map((s) => s.key) },
  });
  return { version, content, narrative, generator };
});
