// Field spec + duplicate detection shared by the registry and the 360 profile.
import type { FieldSpec } from '@/components/forms/RecordForm';
import type { Option } from '@/components/ui';
import { all, list } from '@/services/db';
import type { Beneficiary } from '@/types/db';

const NID = /^[12]\d{9}$/;

export function beneficiaryFields(statusOptions: Option[]): FieldSpec[] {
  return [
    { name: 'full_name', label: ['الاسم الكامل', 'Full name'], type: 'text', required: true },
    { name: 'full_name_en', label: ['الاسم بالإنجليزية', 'Name (English)'], type: 'text' },
    { name: 'national_id', label: ['رقم الهوية / الإقامة', 'National ID / Iqama'], type: 'text',
      hint: ['10 أرقام تبدأ بـ 1 أو 2', '10 digits starting with 1 or 2'],
      validate: (v) => (v && !NID.test(String(v).trim()) ? ['رقم هوية غير صالح', 'Invalid national ID'] : null) },
    { name: 'gender', label: ['الجنس', 'Gender'], type: 'enum', enumGroup: 'gender' },
    { name: 'birth_date', label: ['تاريخ الميلاد', 'Birth date'], type: 'date',
      validate: (v) => (v && String(v) > new Date().toISOString().slice(0, 10) ? ['تاريخ في المستقبل', 'Date is in the future'] : null) },
    { name: 'mobile', label: ['الجوال', 'Mobile'], type: 'tel', placeholder: '05xxxxxxxx' },
    { name: 'email', label: ['البريد الإلكتروني', 'Email'], type: 'email' },
    { name: 'city', label: ['المدينة', 'City'], type: 'text' },
    { name: 'region', label: ['المنطقة', 'Region'], type: 'text' },
    { name: 'education_level', label: ['المستوى التعليمي', 'Education level'], type: 'text' },
    { name: 'specialization', label: ['التخصص', 'Specialization'], type: 'text' },
    { name: 'employment_status', label: ['الحالة الوظيفية', 'Employment status'], type: 'enum', enumGroup: 'employment' },
    { name: 'organization_name', label: ['جهة العمل / المنشأة', 'Employer / venture'], type: 'text' },
    { name: 'status', label: ['الحالة', 'Status'], type: 'select', options: statusOptions, required: true },
    { name: 'tags', label: ['الوسوم', 'Tags'], type: 'tags', full: true },
    { name: 'consent_given', label: ['حصلنا على موافقة المستفيد على معالجة بياناته', 'Beneficiary consent to data processing obtained'], type: 'checkbox', full: true },
    { name: 'notes', label: ['ملاحظات', 'Notes'], type: 'textarea' },
  ];
}

export function beneficiaryInitial(b?: Beneficiary | null): Record<string, unknown> {
  if (!b) return { status: 'active', tags: [], consent_given: false };
  return {
    full_name: b.full_name, full_name_en: b.full_name_en, national_id: b.national_id, gender: b.gender, birth_date: b.birth_date, mobile: b.mobile,
    email: b.email, city: b.city, region: b.region, education_level: b.education_level, specialization: b.specialization,
    employment_status: b.employment_status, organization_name: b.organization_name, status: b.status, tags: b.tags ?? [],
    consent_given: b.consent_given, notes: b.notes,
  };
}

/** Normalizes a mobile number for comparison (digits only, Saudi 05/9665 forms unified). */
export function normMobile(m: string | null | undefined): string {
  let d = (m ?? '').replace(/\D/g, '');
  if (d.startsWith('00966')) d = d.slice(5);
  else if (d.startsWith('966')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return d;
}
export const normEmail = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();
export const normNid = (n: string | null | undefined) => (n ?? '').replace(/\s/g, '');

export type DupKey = 'email' | 'mobile' | 'national_id';
export interface DupHit { key: DupKey; value: string; existing: Pick<Beneficiary, 'id' | 'code' | 'full_name'> }
export type IdentityRow = Pick<Beneficiary, 'id' | 'code' | 'full_name' | 'email' | 'mobile' | 'national_id'>;

export async function loadIdentities(orgId: string): Promise<IdentityRow[]> {
  return all<IdentityRow>('beneficiaries', { select: 'id,code,full_name,email,mobile,national_id', filters: [['organization_id', 'eq', orgId]], order: { column: 'code', ascending: true } }, 50000);
}

export interface IdentityIndex { email: Map<string, IdentityRow>; mobile: Map<string, IdentityRow>; national_id: Map<string, IdentityRow> }
export function indexIdentities(rows: IdentityRow[]): IdentityIndex {
  const idx: IdentityIndex = { email: new Map(), mobile: new Map(), national_id: new Map() };
  for (const r of rows) {
    if (normEmail(r.email)) idx.email.set(normEmail(r.email), r);
    if (normMobile(r.mobile)) idx.mobile.set(normMobile(r.mobile), r);
    if (normNid(r.national_id)) idx.national_id.set(normNid(r.national_id), r);
  }
  return idx;
}

export function findDuplicates(idx: IdentityIndex, v: { email?: unknown; mobile?: unknown; national_id?: unknown }, excludeId?: string): DupHit[] {
  const out: DupHit[] = [];
  const check = (key: DupKey, norm: string) => {
    if (!norm) return;
    const hit = idx[key].get(norm);
    if (hit && hit.id !== excludeId) out.push({ key, value: norm, existing: { id: hit.id, code: hit.code, full_name: hit.full_name } });
  };
  check('email', normEmail(v.email as string | null));
  check('mobile', normMobile(v.mobile as string | null));
  check('national_id', normNid(v.national_id as string | null));
  return out;
}

export const DUP_LABEL: Record<DupKey, [string, string]> = { email: ['البريد', 'email'], mobile: ['الجوال', 'mobile'], national_id: ['الهوية', 'national ID'] };

/** Targeted server lookup used before a single create/edit (no full table load). */
export async function checkDuplicatesRemote(orgId: string, v: { email?: unknown; mobile?: unknown; national_id?: unknown }, excludeId?: string): Promise<DupHit[]> {
  const email = normEmail(v.email as string | null);
  const mobile = normMobile(v.mobile as string | null);
  const nid = normNid(v.national_id as string | null);
  const select = 'id,code,full_name,email,mobile,national_id';
  const base: [string, 'eq', unknown] = ['organization_id', 'eq', orgId];
  const [a, b, c] = await Promise.all([
    email ? list<IdentityRow>('beneficiaries', { select, filters: [base, ['email', 'ilike', email]], pageSize: 5 }) : null,
    mobile.length >= 8 ? list<IdentityRow>('beneficiaries', { select, filters: [base, ['mobile', 'ilike', `%${mobile}`]], pageSize: 5 }) : null,
    nid ? list<IdentityRow>('beneficiaries', { select, filters: [base, ['national_id', 'eq', nid]], pageSize: 5 }) : null,
  ]);
  const idx = indexIdentities([...(a?.rows ?? []), ...(b?.rows ?? []), ...(c?.rows ?? [])]);
  return findDuplicates(idx, v, excludeId);
}
