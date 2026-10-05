// Bulk CSV import: upload → column mapping → validation preview (errors and
// duplicates against existing rows and within the file) → batched insert.
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Upload } from 'lucide-react';
import { Badge, Button, Checkbox, DataTable, Field, FileDrop, Modal, Notice, Progress, Select, type Column } from '@/components/ui';
import { useOrg } from '@/app/OrgProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { insertMany } from '@/services/db';
import { downloadCSV, parseDelimited } from '@/utils/csv';
import { errMsg } from './dataUtils';
import { DUP_LABEL, type DupHit, findDuplicates, indexIdentities, loadIdentities, normEmail, normMobile, normNid } from './beneficiaryForm';

type Target = 'full_name' | 'full_name_en' | 'national_id' | 'gender' | 'birth_date' | 'mobile' | 'email' | 'city' | 'region'
  | 'education_level' | 'specialization' | 'employment_status' | 'organization_name' | 'tags' | 'consent_given' | 'notes';

const TARGETS: { key: Target; ar: string; en: string; aliases: string[]; required?: boolean }[] = [
  { key: 'full_name', ar: 'الاسم الكامل', en: 'Full name', aliases: ['full_name', 'name', 'الاسم', 'الاسم الكامل', 'اسم المستفيد', 'full name'], required: true },
  { key: 'full_name_en', ar: 'الاسم بالإنجليزية', en: 'Name (English)', aliases: ['full_name_en', 'name_en', 'english name', 'الاسم بالانجليزية', 'الاسم بالإنجليزية'] },
  { key: 'national_id', ar: 'رقم الهوية', en: 'National ID', aliases: ['national_id', 'nid', 'id number', 'iqama', 'رقم الهوية', 'الهوية', 'السجل المدني'] },
  { key: 'gender', ar: 'الجنس', en: 'Gender', aliases: ['gender', 'sex', 'الجنس', 'النوع'] },
  { key: 'birth_date', ar: 'تاريخ الميلاد', en: 'Birth date', aliases: ['birth_date', 'dob', 'date of birth', 'birthdate', 'تاريخ الميلاد'] },
  { key: 'mobile', ar: 'الجوال', en: 'Mobile', aliases: ['mobile', 'phone', 'mobile number', 'الجوال', 'رقم الجوال', 'الهاتف'] },
  { key: 'email', ar: 'البريد الإلكتروني', en: 'Email', aliases: ['email', 'e-mail', 'mail', 'البريد', 'البريد الإلكتروني', 'الايميل'] },
  { key: 'city', ar: 'المدينة', en: 'City', aliases: ['city', 'المدينة'] },
  { key: 'region', ar: 'المنطقة', en: 'Region', aliases: ['region', 'province', 'المنطقة'] },
  { key: 'education_level', ar: 'المستوى التعليمي', en: 'Education level', aliases: ['education_level', 'education', 'المؤهل', 'المستوى التعليمي'] },
  { key: 'specialization', ar: 'التخصص', en: 'Specialization', aliases: ['specialization', 'major', 'التخصص'] },
  { key: 'employment_status', ar: 'الحالة الوظيفية', en: 'Employment status', aliases: ['employment_status', 'employment', 'الحالة الوظيفية', 'الوضع الوظيفي'] },
  { key: 'organization_name', ar: 'جهة العمل', en: 'Employer', aliases: ['organization_name', 'employer', 'company', 'جهة العمل', 'المنشأة'] },
  { key: 'tags', ar: 'الوسوم', en: 'Tags', aliases: ['tags', 'الوسوم'] },
  { key: 'consent_given', ar: 'الموافقة', en: 'Consent', aliases: ['consent_given', 'consent', 'الموافقة'] },
  { key: 'notes', ar: 'ملاحظات', en: 'Notes', aliases: ['notes', 'ملاحظات'] },
];

const GENDER: Record<string, 'male' | 'female'> = { male: 'male', m: 'male', 'ذكر': 'male', female: 'female', f: 'female', 'أنثى': 'female', 'انثى': 'female' };
const EMPLOYMENT: Record<string, string> = {
  student: 'student', 'طالب': 'student', 'طالبة': 'student', unemployed: 'unemployed', 'باحث عن عمل': 'unemployed', 'عاطل': 'unemployed',
  employed: 'employed', 'موظف': 'employed', 'موظفة': 'employed', self_employed: 'self_employed', 'self-employed': 'self_employed', 'يعمل لحسابه': 'self_employed',
  entrepreneur: 'entrepreneur', 'رائد أعمال': 'entrepreneur', 'رائدة أعمال': 'entrepreneur', other: 'other', 'أخرى': 'other',
};
const YES = new Set(['yes', 'y', 'true', '1', 'نعم', 'موافق']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BATCH = 200;

interface RowCheck { index: number; values: Record<string, unknown>; errors: [string, string][]; dups: DupHit[]; fileDup: number | null }

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function toDate(v: string): string | null | false {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return false;
}

export function BeneficiaryImportModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const { org } = useOrg();
  const { tr, locale, fmtNumber } = useI18n();
  const [step, setStep] = useState<'upload' | 'map' | 'preview' | 'done'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Partial<Record<Target, number>>>({});
  const [checks, setChecks] = useState<RowCheck[]>([]);
  const [includeDups, setIncludeDups] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState(0);

  const reset = () => { setStep('upload'); setFile(null); setHeader([]); setData([]); setMapping({}); setChecks([]); setError(null); setProgress(0); setImported(0); setIncludeDups(false); };
  const close = () => { reset(); onClose(); };

  const onFile = async (f: File | undefined) => {
    setError(null);
    if (!f) return;
    setFile(f);
    const text = await f.text();
    const rows = parseDelimited(text);
    if (rows.length < 2) { setError(tr('الملف لا يحتوي على صف عناوين وصف بيانات واحد على الأقل.', 'The file needs a header row and at least one data row.')); return; }
    if (rows.length > 5001) { setError(tr('الحد الأقصى 5000 صف في الاستيراد الواحد.', 'Maximum 5,000 rows per import.')); return; }
    const h = rows[0];
    setHeader(h); setData(rows.slice(1));
    const auto: Partial<Record<Target, number>> = {};
    for (const t of TARGETS) {
      const idx = h.findIndex((c) => t.aliases.some((a) => norm(a) === norm(c)));
      if (idx >= 0) auto[t.key] = idx;
    }
    setMapping(auto); setStep('map');
  };

  const validate = async () => {
    setBusy(true); setError(null);
    try {
      const idx = indexIdentities(await loadIdentities(org.id));
      const seen = { email: new Map<string, number>(), mobile: new Map<string, number>(), national_id: new Map<string, number>() };
      const out: RowCheck[] = data.map((row, i) => {
        const cell = (t: Target) => { const c = mapping[t]; return c === undefined ? '' : (row[c] ?? '').trim(); };
        const errors: [string, string][] = [];
        const values: Record<string, unknown> = { organization_id: org.id, status: 'active' };
        const name = cell('full_name');
        if (!name) errors.push(['الاسم مفقود', 'Name is missing']);
        values.full_name = name;
        for (const t of ['full_name_en', 'city', 'region', 'education_level', 'specialization', 'organization_name', 'notes'] as Target[]) values[t] = cell(t) || null;
        const nid = normNid(cell('national_id'));
        if (nid && !/^[12]\d{9}$/.test(nid)) errors.push(['رقم هوية غير صالح', 'Invalid national ID']);
        values.national_id = nid || null;
        const g = cell('gender');
        if (g) { const gv = GENDER[g.toLowerCase()]; if (!gv) errors.push([`جنس غير معروف «${g}»`, `Unknown gender “${g}”`]); values.gender = gv ?? null; } else values.gender = null;
        const bd = toDate(cell('birth_date'));
        if (bd === false) errors.push(['تاريخ ميلاد غير صالح (YYYY-MM-DD أو DD/MM/YYYY)', 'Invalid birth date (YYYY-MM-DD or DD/MM/YYYY)']);
        values.birth_date = bd || null;
        const mob = cell('mobile');
        if (mob && normMobile(mob).length < 8) errors.push(['رقم جوال غير صالح', 'Invalid mobile number']);
        values.mobile = mob || null;
        const em = normEmail(cell('email'));
        if (em && !EMAIL.test(em)) errors.push(['بريد إلكتروني غير صالح', 'Invalid email']);
        values.email = em || null;
        const es = cell('employment_status');
        if (es) { const ev = EMPLOYMENT[es.toLowerCase()]; if (!ev) errors.push([`حالة وظيفية غير معروفة «${es}»`, `Unknown employment status “${es}”`]); values.employment_status = ev ?? null; } else values.employment_status = null;
        const tg = cell('tags');
        values.tags = tg ? [...new Set(tg.split(/[;|،,]/).map((x) => x.trim()).filter(Boolean))] : [];
        const consent = YES.has(cell('consent_given').toLowerCase());
        values.consent_given = consent;
        values.consent_at = consent ? new Date().toISOString() : null;
        const dups = findDuplicates(idx, values);
        let fileDup: number | null = null;
        for (const [k, v] of [['email', em], ['mobile', normMobile(mob)], ['national_id', nid]] as const) {
          if (!v) continue;
          const prev = seen[k].get(v);
          if (prev !== undefined && fileDup === null) fileDup = prev;
          else if (prev === undefined) seen[k].set(v, i);
        }
        return { index: i, values, errors, dups, fileDup };
      });
      setChecks(out); setStep('preview');
    } catch (e) { setError(errMsg(e, locale)); } finally { setBusy(false); }
  };

  const importable = useMemo(() => checks.filter((c) => !c.errors.length && (includeDups || (!c.dups.length && c.fileDup === null))), [checks, includeDups]);
  const counts = useMemo(() => ({
    ok: checks.filter((c) => !c.errors.length && !c.dups.length && c.fileDup === null).length,
    errors: checks.filter((c) => c.errors.length).length,
    dups: checks.filter((c) => !c.errors.length && (c.dups.length || c.fileDup !== null)).length,
  }), [checks]);

  const runImport = async () => {
    setBusy(true); setError(null); setProgress(0);
    let done = 0;
    try {
      for (let i = 0; i < importable.length; i += BATCH) {
        const rows = importable.slice(i, i + BATCH).map((c) => c.values);
        await insertMany('beneficiaries', rows);
        done += rows.length; setProgress((done / importable.length) * 100);
      }
      setImported(done); setStep('done'); onImported();
    } catch (e) {
      setImported(done);
      setError(`${errMsg(e, locale)} — ${tr(`تم استيراد ${done} صفًا قبل التوقف.`, `${done} rows were imported before the error.`)}`);
      if (done) onImported();
    } finally { setBusy(false); }
  };

  const downloadErrors = () => {
    const bad = checks.filter((c) => c.errors.length || c.dups.length || c.fileDup !== null);
    downloadCSV('beneficiary-import-issues', [...header, tr('المشكلات', 'Issues')], bad.map((c) => [
      ...data[c.index], [...c.errors.map((e) => (locale === 'ar' ? e[0] : e[1])), ...c.dups.map((d) => `${tr('مكرر', 'duplicate')} ${tr(...DUP_LABEL[d.key])}: ${d.existing.code}`),
        ...(c.fileDup !== null ? [tr(`مكرر مع الصف ${c.fileDup + 2}`, `duplicate of row ${c.fileDup + 2}`)] : [])].join(' | '),
    ]));
  };

  const cols: Column<RowCheck>[] = [
    { key: 'row', header: '#', value: (c) => c.index + 2, width: 50 },
    { key: 'name', header: tr('الاسم', 'Name'), value: (c) => String(c.values.full_name ?? '') },
    { key: 'email', header: tr('البريد', 'Email'), value: (c) => String(c.values.email ?? ''), render: (c) => <span className="ltr">{String(c.values.email ?? '—')}</span> },
    { key: 'mobile', header: tr('الجوال', 'Mobile'), value: (c) => String(c.values.mobile ?? ''), render: (c) => <span className="ltr">{String(c.values.mobile ?? '—')}</span> },
    { key: 'nid', header: tr('الهوية', 'ID'), value: (c) => String(c.values.national_id ?? ''), render: (c) => <span className="mono">{String(c.values.national_id ?? '—')}</span> },
    { key: 'result', header: tr('نتيجة التحقق', 'Validation'), value: (c) => (c.errors.length ? 'error' : c.dups.length || c.fileDup !== null ? 'duplicate' : 'ok'), render: (c) => (
      <div className="stack-sm" style={{ gap: 2 }}>
        {!c.errors.length && !c.dups.length && c.fileDup === null && <Badge tone="success">{tr('صالح', 'Valid')}</Badge>}
        {c.errors.map((e, i) => <span key={i} className="small" style={{ color: 'var(--danger)' }}>{locale === 'ar' ? e[0] : e[1]}</span>)}
        {c.dups.map((d, i) => <span key={`d${i}`} className="small" style={{ color: 'var(--warning)' }}>{tr(`مطابق بـ${DUP_LABEL[d.key][0]} مع ${d.existing.full_name} (${d.existing.code})`, `Matches ${DUP_LABEL[d.key][1]} of ${d.existing.full_name} (${d.existing.code})`)}</span>)}
        {c.fileDup !== null && <span className="small" style={{ color: 'var(--warning)' }}>{tr(`مكرر مع الصف ${c.fileDup + 2} في الملف`, `Duplicate of row ${c.fileDup + 2} in the file`)}</span>}
      </div>
    ) },
  ];

  const footer = step === 'map' ? (
    <><Button onClick={() => setStep('upload')}>{tr('رجوع', 'Back')}</Button><Button variant="primary" loading={busy} disabled={mapping.full_name === undefined} onClick={() => void validate()}>{tr('التحقق والمعاينة', 'Validate & preview')}</Button></>
  ) : step === 'preview' ? (
    <><Button onClick={() => setStep('map')} disabled={busy}>{tr('رجوع', 'Back')}</Button>
      <Button variant="primary" icon={<Upload />} loading={busy} disabled={!importable.length} onClick={() => void runImport()}>{tr(`استيراد ${importable.length} سجل`, `Import ${importable.length} records`)}</Button></>
  ) : step === 'done' ? <Button variant="primary" onClick={close}>{tr('إغلاق', 'Close')}</Button> : <Button onClick={close}>{tr('إلغاء', 'Cancel')}</Button>;

  return (
    <Modal open={open} onClose={busy ? () => undefined : close} size="wide" title={tr('استيراد المستفيدين من CSV', 'Import beneficiaries from CSV')} footer={footer}>
      <div className="stack">
        <div className="row wrap small muted">
          {(['upload', 'map', 'preview', 'done'] as const).map((s, i) => (
            <Badge key={s} tone={step === s ? 'primary' : 'outline'}>{i + 1}. {[tr('الملف', 'File'), tr('مطابقة الأعمدة', 'Column mapping'), tr('المعاينة والتحقق', 'Validation preview'), tr('النتيجة', 'Result')][i]}</Badge>
          ))}
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        {step === 'upload' && (
          <>
            <FileDrop accept=".csv,.tsv,.txt,text/csv" file={file} onFiles={(f) => void onFile(f[0])} />
            <Notice tone="info">{tr('الصف الأول يجب أن يحتوي أسماء الأعمدة. يدعم الفاصلة أو الفاصلة المنقوطة أو Tab وترميز UTF-8. الوسوم تُفصل بـ ; أو |.', 'The first row must contain column names. Comma, semicolon or tab separated, UTF-8. Separate tags with ; or |.')}</Notice>
            <div><Button size="sm" icon={<Download />} onClick={() => downloadCSV('beneficiaries-template', TARGETS.map((t) => t.key), [])}>{tr('تنزيل قالب الأعمدة', 'Download column template')}</Button></div>
          </>
        )}
        {step === 'map' && (
          <>
            <p className="small muted">{tr(`تم قراءة ${data.length} صفًا. طابق أعمدة الملف مع حقول المستفيد (طابقنا ما أمكن تلقائيًا).`, `${data.length} rows read. Map file columns to beneficiary fields (we auto-matched where possible).`)}</p>
            <div className="form-grid">
              {TARGETS.map((t) => (
                <Field key={t.key} label={locale === 'ar' ? t.ar : t.en} required={t.required}>
                  <Select options={header.map((h, i) => ({ value: String(i), label: h || `#${i + 1}` }))} placeholder={tr('— لا يوجد —', '— Not mapped —')}
                    value={mapping[t.key] === undefined ? '' : String(mapping[t.key])}
                    onChange={(e) => setMapping((m) => ({ ...m, [t.key]: e.target.value === '' ? undefined : Number(e.target.value) }))} />
                </Field>
              ))}
            </div>
            {mapping.email === undefined && mapping.mobile === undefined && mapping.national_id === undefined && (
              <Notice tone="warning">{tr('لم تُطابق أي أعمدة تعريفية (البريد/الجوال/الهوية) — لن يمكن كشف التكرار.', 'No identifying column (email / mobile / national ID) is mapped — duplicates cannot be detected.')}</Notice>
            )}
          </>
        )}
        {step === 'preview' && (
          <>
            <div className="grid g3">
              <div className="card card-pad"><div className="row"><CheckCircle2 size={16} color="var(--success)" /><b>{fmtNumber(counts.ok)}</b><span className="muted small">{tr('صالحة', 'valid')}</span></div></div>
              <div className="card card-pad"><div className="row"><AlertTriangle size={16} color="var(--danger)" /><b>{fmtNumber(counts.errors)}</b><span className="muted small">{tr('بها أخطاء (تُستبعد)', 'with errors (excluded)')}</span></div></div>
              <div className="card card-pad"><div className="row"><AlertTriangle size={16} color="var(--warning)" /><b>{fmtNumber(counts.dups)}</b><span className="muted small">{tr('تكرار محتمل', 'possible duplicates')}</span></div></div>
            </div>
            <div className="row wrap between">
              <Checkbox label={tr('استيراد التكرارات المحتملة أيضًا (غير موصى به)', 'Also import possible duplicates (not recommended)')} checked={includeDups} onChange={setIncludeDups} />
              {(counts.errors > 0 || counts.dups > 0) && <Button size="sm" icon={<Download />} onClick={downloadErrors}>{tr('تنزيل الصفوف ذات المشكلات', 'Download rows with issues')}</Button>}
            </div>
            {busy && <Progress value={progress} large label={tr('تقدم الاستيراد', 'Import progress')} />}
            <DataTable columns={cols} rows={checks} rowKey={(c) => String(c.index)} pageSize={20} searchable dense />
          </>
        )}
        {step === 'done' && (
          <Notice tone="success">{tr(`تم استيراد ${imported} مستفيد بنجاح. تُولّد الرموز تلقائيًا.`, `${imported} beneficiaries imported successfully. Codes were generated automatically.`)}</Notice>
        )}
      </div>
    </Modal>
  );
}
