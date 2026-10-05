// import-external-assessment — assessments.create on the organization.
// Imports external assessment scores (Hogan, SHL, …) from a CSV in the
// org-scoped `imports` bucket or inline csv_text. Rows are matched to the
// organization's beneficiaries, scores are rescaled to the tool scale and
// inserted as assessment_results (the DB trigger computes totals).
import { serve, readJson, fail, check } from '../_shared/http.ts';
import { getCaller, requireOrgRow, requirePermission } from '../_shared/auth.ts';
import { bool, enumOf, number, object, optional, parse, record, string, uuid } from '../_shared/validate.ts';
import { audit } from '../_shared/audit.ts';
import { fetchAll } from '../_shared/bundle.ts';
import { parseCsv, parseNumber } from '../_shared/csv.ts';
import { roundTo } from '../_shared/engine/index.ts';

const MAX_ROWS = 10_000;
const MAX_CSV_BYTES = 5 * 1024 * 1024;

const Body = object({
  organization_id: uuid(),
  tool_id: uuid(),
  program_id: optional(uuid()),
  measurement_point: enumOf(['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'other'] as const),
  provider: optional(string({ max: 120 })),
  file_path: optional(string({ min: 3, max: 500 })),
  csv_text: optional(string({ min: 1, max: MAX_CSV_BYTES, trim: false })),
  mapping: object({
    identifier: enumOf(['code', 'email', 'national_id'] as const),
    identifier_column: string({ min: 1, max: 200 }),
    dimensions: record(string({ min: 1, max: 200 }), { maxKeys: 100, key: uuid() }),
  }),
  source_scale: optional(object({ min: number(), max: number() })),
  dry_run: optional(bool()),
});

interface Ben { id: string; code: string; email: string | null; national_id: string | null }

const norm = (s: string) => s.trim().toLowerCase();

serve(async (req) => {
  const caller = await getCaller(req);
  const b = parse(Body, await readJson(req, MAX_CSV_BYTES + 256 * 1024));
  await requirePermission(caller, b.organization_id, 'assessments.create');
  const admin = caller.admin;
  const org = b.organization_id;

  // ---- references --------------------------------------------------------------
  const tool = await requireOrgRow<{ id: string; scale_min: number; scale_max: number; status: string; name: string }>(admin, 'assessment_tools', b.tool_id, org,
    'id, scale_min, scale_max, status, name');
  if (tool.status === 'archived') fail('invalid_input', { field: 'tool_id', detail: { field: 'tool_id', reason: 'tool is archived' } });
  if (b.program_id) await requireOrgRow(admin, 'programs', b.program_id, org, 'id');
  const dimIds = Object.keys(b.mapping.dimensions);
  if (!dimIds.length) fail('invalid_input', { field: 'mapping.dimensions', detail: { field: 'mapping.dimensions', reason: 'map at least one dimension' } });
  const dims = check(await admin.from('assessment_dimensions').select('id').eq('tool_id', tool.id).eq('organization_id', org).in('id', dimIds), 'assessment_dimensions') as
    { id: string }[];
  if (dims.length !== dimIds.length) fail('invalid_input', { field: 'mapping.dimensions', detail: { field: 'mapping.dimensions', reason: 'unknown dimension for this tool' } });

  const smin = b.source_scale?.min ?? Number(tool.scale_min);
  const smax = b.source_scale?.max ?? Number(tool.scale_max);
  if (!(smax > smin)) fail('invalid_input', { field: 'source_scale', detail: { field: 'source_scale', reason: 'max must be greater than min' } });
  const tmin = Number(tool.scale_min); const tmax = Number(tool.scale_max);

  // ---- CSV -----------------------------------------------------------------------
  let csv: string;
  let originalFilename: string | null = null;
  if (b.file_path) {
    const path = b.file_path.replace(/^\/+/, '');
    if (!path.startsWith(`${org}/`) || path.includes('..')) fail('forbidden', { detail: { reason: 'file must be inside the organization folder of the imports bucket' } });
    const { data, error } = await admin.storage.from('imports').download(path);
    if (error || !data) fail('file_not_found');
    if (data.size > MAX_CSV_BYTES) fail('too_large');
    csv = await data.text();
    originalFilename = path.split('/').pop() ?? null;
  } else if (b.csv_text) {
    csv = b.csv_text;
  } else {
    fail('invalid_input', { field: 'file_path', detail: { field: 'file_path', reason: 'file_path or csv_text is required' } });
  }

  const table = parseCsv(csv);
  if (table.length < 2) fail('invalid_input', { field: 'csv', detail: { field: 'csv', reason: 'the file needs a header row and at least one data row' } });
  const header = table[0].map((h) => h.trim());
  const dataRows = table.slice(1);
  if (dataRows.length > MAX_ROWS) fail('too_large', { detail: { max_rows: MAX_ROWS } });
  const col = (name: string) => header.findIndex((h) => norm(h) === norm(name));
  const idCol = col(b.mapping.identifier_column);
  if (idCol < 0) fail('invalid_input', { field: 'mapping.identifier_column', detail: { field: 'mapping.identifier_column', reason: 'column not found in header' } });
  const dimCols = dimIds.map((id) => ({ id, idx: col(b.mapping.dimensions[id]) }));
  const missing = dimCols.filter((d) => d.idx < 0).map((d) => b.mapping.dimensions[d.id]);
  if (missing.length) fail('invalid_input', { field: 'mapping.dimensions', detail: { field: 'mapping.dimensions', reason: 'columns not found in header', columns: missing } });

  // ---- beneficiaries of this organization ---------------------------------------
  const bens = await fetchAll<Ben>(admin, 'beneficiaries', [['organization_id', 'eq', org]], { columns: 'id, code, email, national_id' });
  const index = new Map<string, string>();
  for (const x of bens) {
    const key = b.mapping.identifier === 'code' ? x.code : b.mapping.identifier === 'email' ? x.email : x.national_id;
    if (key) index.set(norm(key), x.id);
  }

  const rescale = (v: number) => {
    const scaled = tmin + ((v - smin) / (smax - smin)) * (tmax - tmin);
    return roundTo(Math.min(Math.max(scaled, tmin), tmax), 4);
  };

  const matchedRows: { row: number; identifier: string; beneficiary_id: string; dimension_scores: Record<string, number>; raw: Record<string, string> }[] = [];
  const unmatched: { row: number; identifier: string; reason: string }[] = [];
  const seen = new Set<string>();
  dataRows.forEach((r, i) => {
    const rowNo = i + 2; // spreadsheet row number (header = 1)
    const identifier = (r[idCol] ?? '').trim();
    if (!identifier) { unmatched.push({ row: rowNo, identifier, reason: 'empty_identifier' }); return; }
    const benId = index.get(norm(identifier));
    if (!benId) { unmatched.push({ row: rowNo, identifier, reason: 'no_matching_beneficiary' }); return; }
    if (seen.has(benId)) { unmatched.push({ row: rowNo, identifier, reason: 'duplicate_in_file' }); return; }
    const scores: Record<string, number> = {};
    for (const d of dimCols) {
      const v = parseNumber(r[d.idx]);
      if (v !== null) scores[d.id] = rescale(v);
    }
    if (!Object.keys(scores).length) { unmatched.push({ row: rowNo, identifier, reason: 'no_numeric_scores' }); return; }
    seen.add(benId);
    matchedRows.push({ row: rowNo, identifier, beneficiary_id: benId, dimension_scores: scores, raw: Object.fromEntries(header.map((h, j) => [h, r[j] ?? ''])) });
  });

  const preview = matchedRows.slice(0, 20).map((m) => ({ identifier: m.identifier, beneficiary_id: m.beneficiary_id, dimension_scores: m.dimension_scores }));
  const base = { rows: dataRows.length, matched: matchedRows.length, unmatched: unmatched.map(({ row, identifier, reason }) => ({ row, identifier, reason })), preview };
  if (b.dry_run) return { import_id: null, imported: 0, ...base };

  // ---- write -------------------------------------------------------------------------
  const imp = check(await admin.from('external_assessment_imports').insert({
    organization_id: org, tool_id: tool.id, program_id: b.program_id ?? null, provider: b.provider ?? null, file_path: b.file_path ?? null,
    original_filename: originalFilename, measurement_point: b.measurement_point,
    column_mapping: { ...b.mapping, source_scale: { min: smin, max: smax } }, status: 'parsed', row_count: dataRows.length, imported_by: caller.userId,
  }).select('id').single(), 'external_assessment_imports') as { id: string };

  let imported = 0;
  let error: string | null = null;
  for (let i = 0; i < matchedRows.length; i += 500) {
    const chunk = matchedRows.slice(i, i + 500).map((m) => ({
      organization_id: org, tool_id: tool.id, program_id: b.program_id ?? null, beneficiary_id: m.beneficiary_id, measurement_point: b.measurement_point,
      source: 'external_import', import_id: imp.id, dimension_scores: m.dimension_scores, external_raw: m.raw, status: 'submitted', assessor_user_id: caller.userId,
    }));
    const res = await admin.from('assessment_results').insert(chunk).select('id');
    if (res.error) {
      console.error('[import-external-assessment] insert failed', res.error.code, res.error.message);
      error = res.error.message.slice(0, 500);
      break;
    }
    imported += res.data?.length ?? 0;
  }
  const status = imported === 0 ? 'failed' : imported < dataRows.length ? 'partially_imported' : 'imported';
  check(await admin.from('external_assessment_imports').update({ status, imported_count: imported, unmatched: base.unmatched, error })
    .eq('id', imp.id).eq('organization_id', org), 'external_assessment_imports');

  await audit(admin, {
    organization_id: org, actor_user_id: caller.userId, action: 'external_assessment_imported', entity_type: 'external_assessment_imports', entity_id: imp.id,
    summary: `${tool.name}: ${imported}/${dataRows.length}`, new_data: { tool_id: tool.id, program_id: b.program_id ?? null, measurement_point: b.measurement_point, imported, unmatched: unmatched.length, status },
  });
  return { import_id: imp.id, imported, ...base };
});
