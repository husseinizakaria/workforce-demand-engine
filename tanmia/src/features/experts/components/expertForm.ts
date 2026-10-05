import type { FieldSpec } from '@/components/forms/RecordForm';
import type { Option } from '@/components/ui';
import type { Expert } from '@/types/db';

export type Qualification = Expert['qualifications'][number];

export function expertFields(statusOptions: Option[]): FieldSpec[] {
  return [
    { name: 'full_name', label: ['الاسم الكامل', 'Full name'], type: 'text', required: true },
    { name: 'full_name_en', label: ['الاسم بالإنجليزية', 'Name (English)'], type: 'text' },
    { name: 'email', label: ['البريد الإلكتروني', 'Email'], type: 'email' },
    { name: 'mobile', label: ['الجوال', 'Mobile'], type: 'tel' },
    { name: 'city', label: ['المدينة', 'City'], type: 'text' },
    { name: 'status', label: ['الحالة', 'Status'], type: 'select', options: statusOptions, required: true },
    { name: 'roles', label: ['الأدوار', 'Roles'], type: 'enum-multi', enumGroup: 'expertRole', required: true },
    { name: 'delivery_modes', label: ['طرق التقديم', 'Delivery modes'], type: 'enum-multi', enumGroup: 'deliveryMode' },
    { name: 'expertise', label: ['مجالات الخبرة', 'Expertise'], type: 'tags', full: true, hint: ['تُستخدم في المطابقة الذكية', 'Used by smart matching'] },
    { name: 'sectors', label: ['القطاعات', 'Sectors'], type: 'tags' },
    { name: 'languages', label: ['اللغات (رموز مثل ar, en)', 'Languages (codes such as ar, en)'], type: 'tags', placeholder: 'ar, en' },
    { name: 'conflicts', label: ['تعارض المصالح المُعلن', 'Declared conflicts of interest'], type: 'tags', full: true,
      hint: ['أسماء أو رموز جهات/مستفيدين/رعاة لا يجوز إسناد الخبير لهم', 'Names or codes of organizations / beneficiaries / sponsors the expert must not be assigned to'] },
    { name: 'hourly_rate', label: ['سعر الساعة', 'Hourly rate'], type: 'number', min: 0 },
    { name: 'currency', label: ['العملة', 'Currency'], type: 'text' },
    { name: 'max_weekly_hours', label: ['الحد الأقصى للساعات الأسبوعية', 'Max weekly hours'], type: 'number', min: 0, max: 80, step: 1 },
    { name: 'rating', label: ['التقييم (0–5)', 'Rating (0–5)'], type: 'number', min: 0, max: 5, step: 0.1 },
    { name: 'qualifications_text', label: ['المؤهلات (سطر لكل مؤهل: العنوان | الجهة | السنة)', 'Qualifications (one per line: title | issuer | year)'], type: 'textarea',
      validate: (v) => (parseQualifications(String(v ?? '')).some((q) => q.year !== undefined && (q.year < 1950 || q.year > 2100)) ? ['سنة غير صالحة', 'Invalid year'] : null) },
    { name: 'bio', label: ['نبذة', 'Bio'], type: 'textarea' },
  ];
}

export function parseQualifications(text: string): Qualification[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [title, issuer, year] = l.split('|').map((x) => x.trim());
    const y = year ? Number(year) : undefined;
    return { title, ...(issuer ? { issuer } : {}), ...(y !== undefined && Number.isFinite(y) ? { year: y } : {}) };
  });
}
export const qualificationsText = (q: Qualification[] | null | undefined) => (q ?? []).map((x) => [x.title, x.issuer ?? '', x.year ?? ''].join(' | ').replace(/( \| )+$/, '')).join('\n');

export function expertInitial(e?: Expert | null): Record<string, unknown> {
  if (!e) return { status: 'active', roles: [], delivery_modes: ['onsite', 'online'], expertise: [], sectors: [], languages: ['ar'], conflicts: [], currency: 'SAR' };
  return {
    full_name: e.full_name, full_name_en: e.full_name_en, email: e.email, mobile: e.mobile, city: e.city, status: e.status, roles: e.roles, delivery_modes: e.delivery_modes,
    expertise: e.expertise, sectors: e.sectors, languages: e.languages, conflicts: e.conflicts, hourly_rate: e.hourly_rate, currency: e.currency,
    max_weekly_hours: e.max_weekly_hours, rating: e.rating, qualifications_text: qualificationsText(e.qualifications), bio: e.bio,
  };
}

/** Converts normalized form values to an experts row patch. */
export function expertRow(v: Record<string, unknown>): Record<string, unknown> {
  const { qualifications_text, ...rest } = v;
  return { ...rest, currency: (rest.currency as string | null) || 'SAR', qualifications: parseQualifications(String(qualifications_text ?? '')) };
}
