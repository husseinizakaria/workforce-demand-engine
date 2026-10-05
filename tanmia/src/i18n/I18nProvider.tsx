import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { L10n } from '@engine';
import { ENUMS, type EnumGroup } from './enums';

export type Locale = 'ar' | 'en';
const STORAGE_KEY = 'tanmia.locale';

export interface I18n {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  setLocale: (l: Locale) => void;
  /** Inline bilingual text: tr('البرامج', 'Programs'). */
  tr: (ar: string, en: string) => string;
  /** Pick from an engine L10n object. */
  L: (v: L10n | null | undefined) => string;
  /** Label of an enum value (statuses, types, ...). Falls back to the raw value. */
  enumLabel: (group: EnumGroup, value: string | null | undefined) => string;
  enumOptions: (group: EnumGroup) => { value: string; label: string }[];
  fmtDate: (d: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions) => string;
  fmtDateTime: (d: string | Date | null | undefined) => string;
  fmtTime: (d: string | Date | null | undefined) => string;
  fmtNumber: (n: number | null | undefined, digits?: number) => string;
  fmtMoney: (n: number | null | undefined, currency?: string) => string;
  /** Pick a localized column, e.g. name / name_en. */
  pick: (ar: string | null | undefined, en: string | null | undefined) => string;
}

const Ctx = createContext<I18n | null>(null);
const TZ = 'Asia/Riyadh';

function initialLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'ar' || v === 'en') return v;
  } catch { /* storage unavailable */ }
  return 'ar';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    document.title = locale === 'ar' ? 'نماء | منصة البرامج وقياس الأثر' : 'TANMIA | Programs & Impact Platform';
  }, [locale, dir]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);

  const value = useMemo<I18n>(() => {
    const intlLocale = locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB';
    const toDate = (d: string | Date) => (typeof d === 'string' ? new Date(d.length === 10 ? d + 'T00:00:00+03:00' : d) : d);
    return {
      locale, dir, setLocale,
      tr: (ar, en) => (locale === 'ar' ? ar : en),
      L: (v) => (v ? (locale === 'ar' ? v.ar : v.en || v.ar) : ''),
      pick: (ar, en) => (locale === 'ar' ? ar || en || '' : en || ar || ''),
      enumLabel: (group, val) => {
        if (val === null || val === undefined || val === '') return '—';
        const e = ENUMS[group]?.[val];
        return e ? (locale === 'ar' ? e[0] : e[1]) : val;
      },
      enumOptions: (group) => Object.entries(ENUMS[group] ?? {}).map(([value, [ar, en]]) => ({ value, label: locale === 'ar' ? ar : en })),
      fmtDate: (d, opts) => (d ? new Intl.DateTimeFormat(intlLocale, { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric', ...opts }).format(toDate(d)) : '—'),
      fmtDateTime: (d) => (d ? new Intl.DateTimeFormat(intlLocale, { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(toDate(d)) : '—'),
      fmtTime: (d) => (d ? new Intl.DateTimeFormat(intlLocale, { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(toDate(d)) : '—'),
      fmtNumber: (n, digits = 0) => (n === null || n === undefined || Number.isNaN(n) ? '—' : new Intl.NumberFormat(intlLocale, { maximumFractionDigits: digits }).format(n)),
      fmtMoney: (n, currency = 'SAR') => (n === null || n === undefined ? '—' : new Intl.NumberFormat(intlLocale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)),
    };
  }, [locale, dir, setLocale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
