import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Copy, Download, FileUp, Pencil, Plus, Users } from 'lucide-react';
import {
  Badge, Button, Card, CardBody, DataTable, Drawer, Input, Notice, PageHeader, Select, StatusBadge, useConfirm, type Column,
} from '@/components/ui';
import { RecordFormModal } from '@/components/forms/RecordForm';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { all, insert, list, update, type Filter } from '@/services/db';
import { downloadCSV } from '@/utils/csv';
import type { Beneficiary, ProgramEnrollment } from '@/types/db';
import { BeneficiaryImportModal } from '../components/BeneficiaryImportModal';
import {
  beneficiaryFields, beneficiaryInitial, checkDuplicatesRemote, DUP_LABEL, type IdentityRow, loadIdentities, normEmail, normMobile, normNid,
} from '../components/beneficiaryForm';
import { allIn, errMsg } from '../components/dataUtils';

const PAGE = 50;
const SEARCH_COLS = ['full_name', 'full_name_en', 'code', 'email', 'mobile', 'national_id'];

export default function BeneficiariesPage() {
  const { org, can } = useOrg();
  const { tr, enumLabel, enumOptions, fmtNumber, locale } = useI18n();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [page, setPage] = useState(0);
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [gender, setGender] = useState('');
  const [employment, setEmployment] = useState('');
  const [city, setCity] = useState('');
  const [consent, setConsent] = useState('');
  const q = useDebounced(term, 300);
  const cityQ = useDebounced(city, 300);
  const [editing, setEditing] = useState<Beneficiary | null | 'new'>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const filters = useMemo<Filter[]>(() => {
    const f: Filter[] = [['organization_id', 'eq', org.id]];
    if (status) f.push(['status', 'eq', status]);
    if (gender) f.push(['gender', 'eq', gender]);
    if (employment) f.push(['employment_status', 'eq', employment]);
    if (cityQ.trim()) f.push(['city', 'ilike', `%${cityQ.trim().replace(/[%_]/g, '')}%`]);
    if (consent) f.push(['consent_given', 'eq', consent === 'yes']);
    return f;
  }, [org.id, status, gender, employment, cityQ, consent]);

  const state = useAsync(async () => {
    const res = await list<Beneficiary>('beneficiaries', { filters, search: q ? { columns: SEARCH_COLS, term: q } : undefined, order: { column: 'created_at', ascending: false }, page, pageSize: PAGE, count: true });
    let counts = new Map<string, number>();
    try {
      const en = await allIn<Pick<ProgramEnrollment, 'beneficiary_id'>>('program_enrollments', 'beneficiary_id', res.rows.map((r) => r.id), { select: 'beneficiary_id', order: { column: 'enrolled_at' } });
      counts = en.reduce((m, e) => m.set(e.beneficiary_id, (m.get(e.beneficiary_id) ?? 0) + 1), new Map<string, number>());
    } catch { /* programs module not visible → counts unavailable */ }
    return { ...res, counts };
  }, [filters, q, page]);

  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(0); };
  const statusOptions = enumOptions('entityStatus').filter((o) => ['active', 'inactive', 'archived'].includes(o.value));

  const save = async (v: Record<string, unknown>) => {
    const current = editing && editing !== 'new' ? editing : null;
    const dups = await checkDuplicatesRemote(org.id, v, current?.id);
    if (dups.length) {
      const ok = await confirm({
        title: tr('تكرار محتمل', 'Possible duplicate'),
        message: (
          <div className="stack-sm">
            <p>{tr('توجد سجلات بنفس بيانات التعريف:', 'Existing records share identifying details:')}</p>
            <ul className="list-plain small">{dups.map((d, i) => <li key={i}>{d.existing.full_name} <span className="mono">({d.existing.code})</span> — {tr(...DUP_LABEL[d.key])}</li>)}</ul>
            <p className="small muted">{tr('يُفضّل تحديث السجل القائم بدل إنشاء سجل مكرر.', 'Updating the existing record is preferred over creating a duplicate.')}</p>
          </div>
        ),
        confirmLabel: tr('حفظ على أي حال', 'Save anyway'),
      });
      if (!ok) throw { code: 'duplicate', message_ar: 'أُلغي الحفظ بسبب تكرار محتمل.', message_en: 'Save cancelled because of a possible duplicate.' };
    }
    const row: Record<string, unknown> = { ...v };
    if (v.consent_given && !current?.consent_given) row.consent_at = new Date().toISOString();
    if (!v.consent_given) row.consent_at = null;
    if (current) await update<Beneficiary>('beneficiaries', current.id, row);
    else {
      const created = await insert<Beneficiary>('beneficiaries', { ...row, organization_id: org.id });
      navigate(`/app/beneficiaries/${created.id}/overview`);
      return;
    }
    await state.reload();
  };

  const exportAll = async () => {
    setExporting(true); setExportErr(null);
    try {
      const rows = await all<Beneficiary>('beneficiaries', { filters, search: q ? { columns: SEARCH_COLS, term: q } : undefined, order: { column: 'code', ascending: true } }, 50000);
      downloadCSV('beneficiaries', ['code', 'full_name', 'full_name_en', 'national_id', 'gender', 'birth_date', 'mobile', 'email', 'city', 'region', 'education_level', 'specialization', 'employment_status', 'organization_name', 'tags', 'consent_given', 'status'],
        rows.map((b) => [b.code, b.full_name, b.full_name_en, b.national_id, b.gender, b.birth_date, b.mobile, b.email, b.city, b.region, b.education_level, b.specialization, b.employment_status, b.organization_name, (b.tags ?? []).join('; '), b.consent_given, b.status]));
    } catch (e) { setExportErr(errMsg(e, locale)); } finally { setExporting(false); }
  };

  const cols: Column<Beneficiary>[] = [
    { key: 'code', header: tr('الرمز', 'Code'), render: (b) => <span className="mono">{b.code}</span> },
    { key: 'full_name', header: tr('الاسم', 'Name'), render: (b) => <div><b>{b.full_name}</b>{b.full_name_en && <span className="sub">{b.full_name_en}</span>}</div> },
    { key: 'gender', header: tr('الجنس', 'Gender'), value: (b) => enumLabel('gender', b.gender) },
    { key: 'city', header: tr('المدينة', 'City'), value: (b) => b.city ?? '—' },
    { key: 'employment_status', header: tr('الحالة الوظيفية', 'Employment'), value: (b) => enumLabel('employment', b.employment_status) },
    { key: 'programs', header: tr('البرامج', 'Programs'), align: 'end', value: (b) => state.data?.counts.get(b.id) ?? 0 },
    { key: 'contact', header: tr('التواصل', 'Contact'), hideInExport: true, render: (b) => (
      <div className="small"><span className="ltr">{b.mobile ?? '—'}</span>{b.email && <span className="sub ltr">{b.email}</span>}</div>
    ) },
    { key: 'flags', header: tr('مؤشرات', 'Flags'), value: (b) => [b.consent_given ? '' : 'no-consent', b.user_id ? 'portal' : ''].filter(Boolean).join(' '), render: (b) => (
      <div className="row wrap" style={{ gap: 4 }}>
        {!b.consent_given && <Badge tone="warning">{tr('بلا موافقة', 'No consent')}</Badge>}
        {b.user_id && <Badge tone="info">{tr('حساب بوابة', 'Portal')}</Badge>}
        {!b.email && !b.mobile && <Badge tone="danger">{tr('بلا تواصل', 'No contact')}</Badge>}
      </div>
    ) },
    { key: 'status', header: tr('الحالة', 'Status'), value: (b) => b.status, render: (b) => <StatusBadge group="entityStatus" value={b.status} /> },
    { key: 'edit', header: '', hideInExport: true, render: (b) => can('beneficiaries.edit') ? (
      <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} aria-label={tr('تعديل', 'Edit')} onClick={(e) => { e.stopPropagation(); setEditing(b); }} />
    ) : null },
  ];

  return (
    <div className="stack">
      <PageHeader title={tr('سجل المستفيدين', 'Beneficiary registry')} subtitle={tr('سجل موحد عبر جميع برامج المؤسسة، مع كشف التكرار والاستيراد الجماعي.', 'One registry across all organization programs, with duplicate detection and bulk import.')}
        actions={<>
          <Button icon={<Copy />} onClick={() => setDupOpen(true)}>{tr('فحص التكرار', 'Duplicate check')}</Button>
          {can('beneficiaries.export') && <Button icon={<Download />} loading={exporting} onClick={() => void exportAll()}>{tr('تصدير الكل (CSV)', 'Export all (CSV)')}</Button>}
          {can('beneficiaries.create') && <Button icon={<FileUp />} onClick={() => setImportOpen(true)}>{tr('استيراد CSV', 'Import CSV')}</Button>}
          {can('beneficiaries.create') && <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>{tr('مستفيد جديد', 'New beneficiary')}</Button>}
        </>} />
      {exportErr && <Notice tone="danger">{exportErr}</Notice>}
      <Card>
        <CardBody flush>
          <DataTable columns={cols} rows={state.data?.rows ?? []} rowKey={(b) => b.id} loading={state.loading} error={state.error} onRetry={state.reload}
            onRowClick={(b) => navigate(`/app/beneficiaries/${b.id}/overview`)}
            search={{ value: term, onChange: resetPage(setTerm), placeholder: tr('بحث بالاسم أو الرمز أو البريد أو الجوال أو الهوية…', 'Search name, code, email, mobile or ID…') }}
            server={{ page, pageSize: PAGE, total: state.data?.total ?? null, onPage: setPage }}
            exportName={can('beneficiaries.export') ? 'beneficiaries-page' : undefined}
            toolbar={<>
              <Select options={statusOptions} placeholder={tr('كل الحالات', 'All statuses')} value={status} onChange={(e) => resetPage(setStatus)(e.target.value)} style={{ width: 130 }} />
              <Select options={enumOptions('gender')} placeholder={tr('كل الأجناس', 'Any gender')} value={gender} onChange={(e) => resetPage(setGender)(e.target.value)} style={{ width: 120 }} />
              <Select options={enumOptions('employment')} placeholder={tr('كل الحالات الوظيفية', 'Any employment')} value={employment} onChange={(e) => resetPage(setEmployment)(e.target.value)} style={{ width: 160 }} />
              <Select options={[{ value: 'yes', label: tr('بموافقة', 'With consent') }, { value: 'no', label: tr('بدون موافقة', 'Without consent') }]} placeholder={tr('الموافقة', 'Consent')} value={consent} onChange={(e) => resetPage(setConsent)(e.target.value)} style={{ width: 130 }} />
              <Input placeholder={tr('المدينة', 'City')} value={city} onChange={(e) => resetPage(setCity)(e.target.value)} style={{ width: 120 }} />
              <span className="small muted"><Users size={13} /> {fmtNumber(state.data?.total ?? 0)}</span>
            </>}
            empty={{ title: tr('لا يوجد مستفيدون مطابقون', 'No matching beneficiaries'), description: tr('أضف مستفيدًا أو استورد ملف CSV.', 'Add a beneficiary or import a CSV file.') }} />
        </CardBody>
      </Card>

      <RecordFormModal open={editing !== null} size="wide" onClose={() => setEditing(null)}
        title={editing === 'new' ? tr('مستفيد جديد', 'New beneficiary') : tr('تعديل المستفيد', 'Edit beneficiary')}
        fields={beneficiaryFields(statusOptions)} initial={beneficiaryInitial(editing === 'new' ? null : editing)} onSubmit={save}
        intro={<p className="small muted">{tr('نتحقق من التكرار بالبريد والجوال والهوية قبل الحفظ.', 'We check for duplicates by email, mobile and national ID before saving.')}</p>} />
      <BeneficiaryImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={() => void state.reload()} />
      {dupOpen && <DuplicateDrawer onClose={() => setDupOpen(false)} />}
    </div>
  );
}

function DuplicateDrawer({ onClose }: { onClose: () => void }) {
  const { org } = useOrg();
  const { tr } = useI18n();
  const navigate = useNavigate();
  const state = useAsync(async () => {
    const rows = await loadIdentities(org.id);
    const groups: { key: string; kind: keyof typeof DUP_LABEL; value: string; rows: IdentityRow[] }[] = [];
    const add = (kind: keyof typeof DUP_LABEL, f: (r: IdentityRow) => string) => {
      const m = new Map<string, IdentityRow[]>();
      for (const r of rows) { const k = f(r); if (k) m.set(k, [...(m.get(k) ?? []), r]); }
      for (const [value, rs] of m) if (rs.length > 1) groups.push({ key: `${kind}:${value}`, kind, value, rows: rs });
    };
    add('national_id', (r) => normNid(r.national_id));
    add('email', (r) => normEmail(r.email));
    add('mobile', (r) => normMobile(r.mobile));
    return { total: rows.length, groups };
  }, [org.id]);
  return (
    <Drawer open onClose={onClose} title={tr('فحص التكرار في السجل', 'Registry duplicate check')} wide>
      {state.error ? <Notice tone="danger">{tr('تعذر الفحص', 'Check failed')}</Notice> : !state.data ? <p className="muted">{tr('جارٍ الفحص…', 'Checking…')}</p> : (
        <div className="stack-sm">
          <Notice tone={state.data.groups.length ? 'warning' : 'success'}>
            {state.data.groups.length
              ? tr(`وُجدت ${state.data.groups.length} مجموعة تكرار محتملة بين ${state.data.total} سجل. راجعها ودمج البيانات يدويًا عند الحاجة.`, `${state.data.groups.length} possible duplicate groups among ${state.data.total} records. Review and merge manually if needed.`)
              : tr(`لا توجد تكرارات بالبريد أو الجوال أو الهوية بين ${state.data.total} سجل.`, `No duplicates by email, mobile or national ID among ${state.data.total} records.`)}
          </Notice>
          {state.data.groups.slice(0, 200).map((g) => (
            <div key={g.key} className="card card-pad">
              <div className="row between"><b>{tr(...DUP_LABEL[g.kind])}: <span className="ltr">{g.value}</span></b><Badge tone="warning">{g.rows.length}</Badge></div>
              <ul className="list-plain small">
                {g.rows.map((r) => <li key={r.id} className="row between"><a href="#" onClick={(e) => { e.preventDefault(); navigate(`/app/beneficiaries/${r.id}/overview`); }}>{r.full_name}</a><span className="mono">{r.code}</span></li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}
