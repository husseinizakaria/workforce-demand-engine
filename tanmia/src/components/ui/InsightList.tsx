import { ArrowLeftRight, Check, CornerDownLeft, X } from 'lucide-react';
import { Link } from 'react-router';
import type { Insight } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { Badge, toneOf } from './Badge';
import { Button } from './Button';
import { EmptyState } from './States';
import { cx } from '@/utils/cx';

/** Explainable recommendations: severity, rationale, recommended action, data source. */
export function InsightList({ insights, linkBase, onDecide, max, emptyTitle }: {
  insights: Insight[]; linkBase?: string; onDecide?: (i: Insight, decision: 'accepted' | 'dismissed') => void; max?: number; emptyTitle?: string;
}) {
  const { L, enumLabel, tr } = useI18n();
  const list = max ? insights.slice(0, max) : insights;
  if (!list.length) return <EmptyState compact icon={<Check />} title={emptyTitle ?? tr('لا توجد ملاحظات — لم تُرصد مشكلات بالقواعد الحالية', 'No findings — the current rules detected no issues')} />;
  return (
    <div className="insights">
      {list.map((i) => (
        <div key={i.fingerprint} className={cx('insight', i.severity)}>
          <span className="bar" aria-hidden />
          <div className="stack-sm" style={{ gap: 4 }}>
            <div className="row between start">
              <span className="ttl">{L(i.title)}</span>
              <div className="meta">
                <Badge tone={toneOf(i.severity)}>{enumLabel('severity', i.severity)}</Badge>
                <Badge tone="outline">{enumLabel('insightKind', i.kind)}</Badge>
              </div>
            </div>
            <p className="why">{L(i.rationale)}</p>
            <div className="row between wrap">
              <span className="act"><CornerDownLeft aria-hidden />{L(i.recommended_action)}</span>
              <div className="row">
                {linkBase && i.link && <Link className="small" to={`${linkBase}/${i.link}`}><ArrowLeftRight size={13} /> {tr('الانتقال', 'Open')}</Link>}
                {onDecide && <>
                  <Button size="sm" variant="ghost" icon={<Check />} onClick={() => onDecide(i, 'accepted')}>{tr('قبول', 'Accept')}</Button>
                  <Button size="sm" variant="ghost" icon={<X />} onClick={() => onDecide(i, 'dismissed')}>{tr('استبعاد', 'Dismiss')}</Button>
                </>}
              </div>
            </div>
            <span className="tiny muted mono" title={tr('قاعدة التحليل', 'Analysis rule')}>{i.rule_code}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
