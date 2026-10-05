// Participants from the program's enrollments (optionally narrowed to a cohort);
// team members are pre-selected when a team is chosen.
import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { Button, Checkbox, EntityPicker, Input, Notice } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync } from '@/hooks/useAsync';
import { all } from '@/services/db';
import type { Beneficiary, ProgramEnrollment, ProgramTeamMember } from '@/types/db';
import { allIn } from '@/features/beneficiaries/components/dataUtils';

export interface PersonOption { id: string; name: string; code: string }

export function ParticipantPicker({ programId, cohortId, teamId, value, onChange, onOptions, capacity }: {
  programId: string | null; cohortId: string | null; teamId: string | null; value: string[]; onChange: (ids: string[]) => void;
  onOptions?: (opts: PersonOption[]) => void; capacity?: number | null;
}) {
  const { org } = useOrg();
  const { tr, pick } = useI18n();
  const [q, setQ] = useState('');
  const [extra, setExtra] = useState<PersonOption[]>([]);
  const state = useAsync(async () => {
    if (!programId) return { people: [] as PersonOption[], team: [] as string[] };
    const filters: [string, 'eq', string][] = [['organization_id', 'eq', org.id], ['program_id', 'eq', programId]];
    if (cohortId) filters.push(['cohort_id', 'eq', cohortId]);
    const en = await all<ProgramEnrollment>('program_enrollments', { filters, order: { column: 'enrolled_at', ascending: true } });
    const active = en.filter((e) => ['active', 'completed', 'graduated'].includes(e.status));
    const bens = await allIn<Pick<Beneficiary, 'id' | 'code' | 'full_name' | 'full_name_en'>>('beneficiaries', 'id', active.map((e) => e.beneficiary_id), { select: 'id,code,full_name,full_name_en', order: { column: 'full_name', ascending: true } });
    const team = teamId ? (await all<ProgramTeamMember>('program_team_members', { filters: [['team_id', 'eq', teamId]] })).map((m) => m.beneficiary_id) : [];
    return { people: bens.map((b) => ({ id: b.id, name: pick(b.full_name, b.full_name_en), code: b.code })), team };
  }, [org.id, programId, cohortId, teamId]);

  const options = useMemo(() => {
    const m = new Map<string, PersonOption>();
    for (const p of [...(state.data?.people ?? []), ...extra]) m.set(p.id, p);
    return [...m.values()];
  }, [state.data, extra]);
  useEffect(() => { onOptions?.(options); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);
  useEffect(() => {
    if (state.data?.team.length) onChange([...new Set([...value, ...state.data.team])]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data?.team.join(',')]);

  const visible = options.filter((o) => !q.trim() || `${o.name} ${o.code}`.toLowerCase().includes(q.trim().toLowerCase()));
  const set = new Set(value);
  return (
    <div className="stack-sm">
      <div className="row wrap">
        <Input placeholder={tr('بحث في المشاركين…', 'Search participants…')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} />
        <Button size="sm" onClick={() => onChange([...new Set([...value, ...visible.map((v) => v.id)])])} disabled={!visible.length}>{tr('تحديد الظاهرين', 'Select shown')}</Button>
        <Button size="sm" variant="ghost" onClick={() => onChange([])} disabled={!value.length}>{tr('إلغاء التحديد', 'Clear')}</Button>
        <span className="small muted"><Users size={13} /> {value.length} / {options.length}{capacity ? ` · ${tr('السعة', 'capacity')} ${capacity}` : ''}</span>
      </div>
      {capacity && value.length > capacity ? <Notice tone="warning">{tr(`عدد المشاركين (${value.length}) يتجاوز سعة الجلسة (${capacity}).`, `Participants (${value.length}) exceed the session capacity (${capacity}).`)}</Notice> : null}
      {!programId && <p className="small muted">{tr('اختر برنامجًا لعرض الملتحقين، أو أضف مستفيدين يدويًا.', 'Choose a program to list its enrollees, or add beneficiaries manually.')}</p>}
      {state.loading && programId && <p className="small muted">{tr('جارٍ التحميل…', 'Loading…')}</p>}
      {state.error && <Notice tone="danger">{tr('تعذر تحميل الملتحقين', 'Could not load enrollees')}</Notice>}
      {programId && !state.loading && !options.length && <p className="small muted">{tr('لا يوجد ملتحقون نشطون في هذا النطاق.', 'No active enrollees in this scope.')}</p>}
      {visible.length > 0 && (
        <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px' }}>
          <div className="grid g2" style={{ gap: '4px 12px' }}>
            {visible.map((o) => (
              <Checkbox key={o.id} checked={set.has(o.id)} onChange={(c) => onChange(c ? [...value, o.id] : value.filter((x) => x !== o.id))}
                label={<span className="small">{o.name} <span className="mono tiny muted">{o.code}</span>{state.data?.team.includes(o.id) ? ' ★' : ''}</span>} />
            ))}
          </div>
        </div>
      )}
      <div style={{ maxWidth: 360 }}>
        <EntityPicker kind="beneficiaries" organizationId={org.id} value={null} placeholder={tr('+ إضافة مستفيد آخر', '+ Add another beneficiary')}
          onChange={(id, label) => { if (!id) return; setExtra((x) => [...x, { id, name: (label ?? '').split(' · ')[0], code: (label ?? '').split(' · ')[1] ?? '' }]); if (!set.has(id)) onChange([...value, id]); }} />
      </div>
    </div>
  );
}
