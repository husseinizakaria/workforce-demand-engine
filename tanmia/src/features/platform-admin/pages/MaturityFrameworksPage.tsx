import { useMemo, useState } from 'react';
import { Layers, Pencil, Plus } from 'lucide-react';
import { TRACKS } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { Badge, Button, Card, CardBody, DataTable, Notice, PageHeader, Select, StatusBadge } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import * as db from '@/services/db';
import type { MaturityFramework } from '@/types/db';
import { PlatformFormModal, type PlatformFieldSpec } from '../components/PlatformForm';
import { MaturityDimensionsDrawer, dimensionProblems, levelRange } from '../components/MaturityDimensionsDrawer';

export default function MaturityFrameworksPage() {
  const { tr, pick, enumLabel } = useI18n();
  const state = useAsync(() => db.all<MaturityFramework>('maturity_frameworks', { filters: [['organization_id', 'is', null], ['program_id', 'is', null]], order: [{ column: 'track_code', ascending: true }, { column: 'code', ascending: true }] }), []);
  const [track, setTrack] = useState('');
  const [editing, setEditing] = useState<MaturityFramework | 'new' | null>(null);
  const [dimsOf, setDimsOf] = useState<MaturityFramework | null>(null);

  const rows = useMemo(() => (state.data ?? []).filter((f) => !track || (track === '_none' ? !f.track_code : f.track_code === track)), [state.data, track]);
  const missingTracks = TRACKS.filter((t) => !(state.data ?? []).some((f) => f.track_code === t.code && f.status === 'active'));

  const fields: PlatformFieldSpec[] = [
    { name: 'name', label: ['الاسم (عربي)', 'Name (Arabic)'], type: 'text', required: true },
    { name: 'name_en', label: ['الاسم (إنجليزي)', 'Name (English)'], type: 'text' },
    { name: 'track_code', label: ['المسار', 'Track'], type: 'select', options: TRACKS.map((t) => ({ value: t.code, label: pick(t.name_ar, t.name_en) })), hint: ['اتركه فارغًا لإطار عام', 'Leave empty for a general framework'] },
    { name: 'status', label: ['الحالة', 'Status'], type: 'select', required: true, options: (['draft', 'active', 'archived'] as const).map((s) => ({ value: s, label: enumLabel('toolStatus', s) })) },
    { name: 'scale_min', label: ['أدنى المقياس', 'Scale min'], type: 'number', required: true, step: 1 },
    { name: 'scale_max', label: ['أعلى المقياس', 'Scale max'], type: 'number', required: true, step: 1,
      validate: (v, all) => (Number(v) > Number(all.scale_min) ? (Number(v) - Number(all.scale_min) <= 9 ? null : ['10 مستويات كحد أقصى', 'At most 10 levels']) : ['يجب أن يتجاوز الحد الأدنى', 'Must exceed the minimum']) },
    { name: 'weighted', label: ['احتساب موزون للأبعاد', 'Weighted dimension scoring'], type: 'checkbox', full: true },
    { name: 'description', label: ['الوصف', 'Description'], type: 'textarea' },
  ];

  return (
    <div className="stack">
      <PageHeader title={tr('أطر النضج المركزية', 'Central maturity frameworks')} crumbs={[{ label: tr('إدارة المنصة', 'Platform'), to: '/platform' }, { label: tr('أطر النضج', 'Maturity frameworks') }]}
        subtitle={tr('أطر لقياس النضج قبل/بعد (T0…T5). تنسخها المؤسسات إلى مساحاتها؛ التعديل هنا يؤثر على النسخ الجديدة فقط.', 'Frameworks for before/after maturity measurement (T0…T5). Organizations copy them; edits here affect new copies only.')}
        actions={<Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>{tr('إطار جديد', 'New framework')}</Button>} />
      {state.data && missingTracks.length > 0 && (
        <Notice tone="warning">{tr(`مسارات بلا إطار نضج نشط: ${missingTracks.map((t) => t.name_ar).join('، ')}. لن تجد مؤسساتها إطارًا جاهزًا لنسخه.`, `Tracks without an active maturity framework: ${missingTracks.map((t) => t.name_en).join(', ')}. Their organizations will find nothing ready to copy.`)}</Notice>
      )}
      <Card>
        <CardBody flush>
          <DataTable<MaturityFramework> rows={rows} rowKey={(r) => r.id} loading={state.loading} error={state.error} onRetry={() => void state.reload()} searchable exportName="central-maturity-frameworks"
            toolbar={<Select style={{ width: 220 }} value={track} onChange={(e) => setTrack(e.target.value)} options={[{ value: '', label: tr('كل المسارات', 'All tracks') }, ...TRACKS.map((t) => ({ value: t.code, label: pick(t.name_ar, t.name_en) })), { value: '_none', label: tr('عام (بلا مسار)', 'General (no track)') }]} />}
            empty={{ title: tr('لا توجد أطر نضج', 'No maturity frameworks') }}
            columns={[
              { key: 'code', header: tr('الرمز', 'Code'), value: (r) => r.code, render: (r) => <span className="mono">{r.code} <span className="muted">v{r.version}</span></span>, sortable: true },
              { key: 'name', header: tr('الاسم', 'Name'), value: (r) => pick(r.name, r.name_en), sortable: true },
              { key: 'track', header: tr('المسار', 'Track'), value: (r) => r.track_code ?? '', render: (r) => r.track_code ? <Badge>{enumLabel('track', r.track_code)}</Badge> : <span className="muted small">{tr('عام', 'General')}</span> },
              { key: 'scale', header: tr('المقياس', 'Scale'), value: (r) => `${r.scale_min}-${r.scale_max}`, render: (r) => <span className="mono">{r.scale_min}–{r.scale_max}</span> },
              { key: 'weighted', header: tr('موزون', 'Weighted'), value: (r) => r.weighted, render: (r) => (r.weighted ? tr('نعم', 'Yes') : tr('لا', 'No')) },
              { key: 'dims', header: tr('الأبعاد', 'Dimensions'), align: 'end', value: (r) => r.dimensions.length, render: (r) => {
                const probs = dimensionProblems(r.dimensions, r.weighted).length;
                const empty = r.dimensions.reduce((a, d) => a + levelRange(r).filter((l) => !d.levels?.[String(l)]?.ar?.trim()).length, 0);
                return <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>{r.dimensions.length}{probs > 0 && <Badge tone="danger">!</Badge>}{empty > 0 && <Badge tone="warning" title={tr('واصفات فارغة', 'Empty descriptors')}>{empty}</Badge>}</div>;
              } },
              { key: 'status', header: tr('الحالة', 'Status'), value: (r) => r.status, render: (r) => <StatusBadge group="toolStatus" value={r.status} /> },
              { key: 'actions', header: '', hideInExport: true, render: (r) => (
                <div className="row">
                  <Button size="sm" icon={<Layers />} onClick={() => setDimsOf(r)}>{tr('الأبعاد', 'Dimensions')}</Button>
                  <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={() => setEditing(r)} />
                </div>
              ) },
            ]} />
        </CardBody>
      </Card>
      <PlatformFormModal open={!!editing} onClose={() => setEditing(null)} fields={fields}
        title={editing === 'new' ? tr('إطار نضج مركزي جديد', 'New central maturity framework') : tr('تعديل الإطار', 'Edit framework')}
        initial={editing && editing !== 'new' ? { ...editing } : { scale_min: 1, scale_max: 5, weighted: true, status: 'draft', track_code: track && track !== '_none' ? track : '' }}
        onSubmit={async (v) => {
          if (editing === 'new') {
            const created = await db.insert<MaturityFramework>('maturity_frameworks', { ...v, organization_id: null, program_id: null, dimensions: [] });
            setDimsOf(created);
          } else if (editing) await db.update('maturity_frameworks', editing.id, v);
          await state.reload();
        }} />
      <MaturityDimensionsDrawer fw={dimsOf} onClose={() => setDimsOf(null)} onSaved={() => void state.reload()} />
    </div>
  );
}
