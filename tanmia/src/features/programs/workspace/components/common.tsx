// Small building blocks shared by the workspace tabs.
import { useState, type ReactNode } from 'react';
import { ExternalLink, Lightbulb, Plus, Trash2 } from 'lucide-react';
import type { HealthArea } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { BarList, Button, Card, CardBody, CardHeader, InsightList, Input, scoreTone, useToast } from '@/components/ui';
import { signedUrl, type Bucket } from '@/services/storage';
import { errorOf } from '@/services/errors';
import { errText } from '../../lib';
import { useWorkspace } from '../context';

/** Engine findings relevant to the current tab (filtered by the insight's workspace link). */
export function TabInsights({ links, title, max = 6 }: { links: string[]; title?: string; max?: number }) {
  const { tr } = useI18n();
  const { health, base } = useWorkspace();
  const list = health.insights.filter((i) => i.link && links.includes(i.link));
  if (!list.length) return null;
  return (
    <Card>
      <CardHeader icon={<Lightbulb />} title={title ?? tr('ملاحظات المحرك لهذا القسم', 'Engine findings for this section')}
        hint={tr('توصيات قابلة للمراجعة، لا تُطبق تلقائيًا', 'Recommendations for review — never auto-applied')} />
      <CardBody flush><InsightList insights={list} linkBase={base} max={max} /></CardBody>
    </Card>
  );
}

export function HealthAreas() {
  const { enumLabel, fmtNumber } = useI18n();
  const { health } = useWorkspace();
  const areas = Object.entries(health.areas) as [HealthArea, number][];
  return (
    <BarList max={100} format={(v) => fmtNumber(v)}
      items={areas.map(([k, v]) => ({ label: enumLabel('healthArea', k), value: v, tone: scoreTone(v) }))} />
  );
}

/** Open a private storage object via a short-lived signed URL. */
export function useOpenFile() {
  const toast = useToast();
  const { locale } = useI18n();
  return async (bucket: Bucket, path: string) => {
    const w = window.open('', '_blank');
    if (w) w.opener = null;
    try {
      const url = await signedUrl(bucket, path, 600);
      if (w) w.location.href = url; else window.open(url, '_blank', 'noopener');
    } catch (e) {
      w?.close();
      toast.error(errText(locale, errorOf(e)));
    }
  };
}

export function FileLink({ bucket, path, url, label }: { bucket: Bucket; path: string | null; url?: string | null; label?: string }) {
  const { tr } = useI18n();
  const open = useOpenFile();
  if (path) return <button type="button" className="link-btn small" onClick={() => void open(bucket, path)}><ExternalLink size={12} /> {label ?? tr('عرض', 'View')}</button>;
  if (url) return <a className="small" href={url} target="_blank" rel="noreferrer noopener"><ExternalLink size={12} /> {label ?? tr('فتح الرابط', 'Open link')}</a>;
  return <span className="muted">—</span>;
}

/** Editable list of short statements (Theory of Change items, objectives...). */
export function ListEditor({ value, onChange, placeholder, disabled }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; disabled?: boolean }) {
  const { tr } = useI18n();
  const [draft, setDraft] = useState('');
  const add = () => { const t = draft.trim(); if (t) { onChange([...value, t]); setDraft(''); } };
  return (
    <div className="stack-sm">
      {value.map((item, i) => (
        <div key={i} className="row">
          <Input value={item} disabled={disabled} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          {!disabled && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} aria-label={tr('حذف', 'Remove')} onClick={() => onChange(value.filter((_, j) => j !== i))} />}
        </div>
      ))}
      {!disabled && (
        <div className="row">
          <Input value={draft} placeholder={placeholder ?? tr('أضف عنصرًا ثم Enter', 'Add an item then Enter')} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <Button size="sm" icon={<Plus />} onClick={add} disabled={!draft.trim()}>{tr('إضافة', 'Add')}</Button>
        </div>
      )}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stack-sm" style={{ gap: 0 }}>
      <span className="tiny muted">{label}</span>
      <span className="strong">{value}</span>
      {hint && <span className="tiny muted">{hint}</span>}
    </div>
  );
}

/** Actions column helper: renders children only, stopping row-click propagation. */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>{children}</div>;
}
