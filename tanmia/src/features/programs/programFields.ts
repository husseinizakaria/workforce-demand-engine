// Field definitions for program basics (wizard step 2 and the overview edit dialog).
import type { FieldSpec } from '@/components/forms/RecordForm';
import { dateOrderError } from './lib';

export const PROGRAM_FIELDS: FieldSpec[] = [
  { name: 'name', label: ['اسم البرنامج', 'Program name'], type: 'text', required: true },
  { name: 'name_en', label: ['الاسم بالإنجليزية', 'English name'], type: 'text' },
  { name: 'start_date', label: ['تاريخ البداية', 'Start date'], type: 'date', hint: ['يحدد نقطة القياس القبلي T0', 'Anchors the T0 baseline'] },
  {
    name: 'end_date', label: ['تاريخ النهاية', 'End date'], type: 'date', hint: ['تُحسب منه نقاط المتابعة T1–T5', 'Follow-up points T1–T5 are computed from it'],
    validate: (v, all) => dateOrderError(all.start_date, v),
  },
  { name: 'target_beneficiaries', label: ['عدد المستفيدين المستهدف', 'Target beneficiaries'], type: 'number', min: 0, step: 1, hint: ['يقاس الوصول مقابله', 'Reach is measured against it'] },
  { name: 'budget_total', label: ['الميزانية الإجمالية (ر.س)', 'Total budget (SAR)'], type: 'number', min: 0 },
  { name: 'region', label: ['المنطقة / المدينة', 'Region / city'], type: 'text' },
  { name: 'delivery_mode', label: ['طريقة التنفيذ', 'Delivery mode'], type: 'enum', enumGroup: 'deliveryMode' },
  { name: 'sponsor_partner_id', label: ['الشريك الراعي', 'Sponsor partner'], type: 'entity', entity: 'partners', full: true,
    hint: ['يُستخدم أيضًا لفحص تعارض المصالح عند مطابقة الخبراء', 'Also used to check conflicts of interest when matching experts'] },
  { name: 'description', label: ['الوصف', 'Description'], type: 'textarea' },
  { name: 'objectives', label: ['الأهداف', 'Objectives'], type: 'textarea', hint: ['أهداف قابلة للقياس تُربط لاحقًا بالمؤشرات', 'Measurable objectives later linked to indicators'] },
];
