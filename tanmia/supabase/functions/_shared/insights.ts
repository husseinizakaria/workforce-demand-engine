// Persists engine insights into ai_insights with fingerprint de-duplication:
//  * new fingerprints → inserted as open insights (Arabic text in the columns,
//    English + source facts in source_data)
//  * open insights whose fingerprint disappeared → status 'resolved'
//  * fingerprints a human already accepted/dismissed are not re-opened
import type { Insight } from './engine/index.ts';
import type { Db } from './auth.ts';
import { check, dbError } from './http.ts';
import { fetchAll } from './bundle.ts';

export interface PersistResult { created: { id: string; severity: string; title: string; fingerprint: string }[]; resolved: number; open: number }

function toRow(org: string, programId: string, i: Insight) {
  return {
    organization_id: org,
    program_id: programId,
    scope: 'program',
    kind: i.kind,
    severity: i.severity,
    rule_code: i.rule_code,
    fingerprint: i.fingerprint,
    title: i.title.ar,
    rationale: i.rationale.ar,
    recommended_action: i.recommended_action.ar,
    source_data: {
      en: { title: i.title.en, rationale: i.rationale.en, recommended_action: i.recommended_action.en },
      area: i.area,
      link: i.link ?? null,
      ...i.source_data,
    },
    generated_by: 'rules',
    status: 'open',
  };
}

export async function persistInsights(admin: Db, org: string, programId: string, insights: Insight[]): Promise<PersistResult> {
  const existing = await fetchAll<{ id: string; fingerprint: string | null; status: string; severity: string }>(admin, 'ai_insights',
    [['organization_id', 'eq', org], ['program_id', 'eq', programId], ['fingerprint', 'not_null'], ['status', 'in', ['open', 'accepted', 'dismissed']]],
    { columns: 'id, fingerprint, status, severity' });
  const open = new Map(existing.filter((e) => e.status === 'open').map((e) => [e.fingerprint!, e]));
  const decided = new Set(existing.filter((e) => e.status !== 'open').map((e) => e.fingerprint!));

  // Engine may emit the same fingerprint twice; keep the most severe.
  const current = new Map<string, Insight>();
  const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  for (const i of insights) {
    const prev = current.get(i.fingerprint);
    if (!prev || rank[i.severity] > rank[prev.severity]) current.set(i.fingerprint, i);
  }

  const fresh = [...current.values()].filter((i) => !open.has(i.fingerprint) && !decided.has(i.fingerprint));
  const created: PersistResult['created'] = [];
  if (fresh.length) {
    const rows = fresh.map((i) => toRow(org, programId, i));
    const res = await admin.from('ai_insights').insert(rows).select('id, severity, title, fingerprint');
    if (!res.error) {
      created.push(...(res.data ?? []));
    } else if (res.error.code === '23505') {
      // A concurrent run inserted some of them: fall back to row-by-row.
      for (const row of rows) {
        const r = await admin.from('ai_insights').insert(row).select('id, severity, title, fingerprint').maybeSingle();
        if (r.error && r.error.code !== '23505') throw dbError(r.error, 'ai_insights');
        if (r.data) created.push(r.data);
      }
    } else {
      check(res, 'ai_insights');
    }
  }

  // Refresh severity/text of still-open insights whose severity changed.
  for (const [fp, row] of open) {
    const i = current.get(fp);
    if (i && i.severity !== row.severity) {
      const r = toRow(org, programId, i);
      check(await admin.from('ai_insights').update({ severity: r.severity, title: r.title, rationale: r.rationale, recommended_action: r.recommended_action, source_data: r.source_data })
        .eq('id', row.id).eq('organization_id', org), 'ai_insights');
    }
  }

  const gone = [...open.entries()].filter(([fp]) => !current.has(fp)).map(([, r]) => r.id);
  if (gone.length) {
    check(await admin.from('ai_insights')
      .update({ status: 'resolved', decided_at: new Date().toISOString(), decision_note: 'auto-resolved: no longer detected by the health check' })
      .eq('organization_id', org).eq('status', 'open').in('id', gone), 'ai_insights');
  }
  const stillOpen = [...open.keys()].filter((fp) => current.has(fp)).length + created.length;
  return { created, resolved: gone.length, open: stillOpen };
}
