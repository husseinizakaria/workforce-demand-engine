import { CheckCircle2 } from 'lucide-react';
import { Badge, Notice } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { CONFLICT_LABEL, conflictDetail, type RpcConflict } from './ops';

const TONE = { high: 'danger', medium: 'warning', low: 'info' } as const;
const SEV: Record<string, [string, string]> = { high: ['عالية', 'High'], medium: ['متوسطة', 'Medium'], low: ['منخفضة', 'Low'] };

export function ConflictList({ conflicts, benName, compact }: { conflicts: RpcConflict[]; benName?: (id: string) => string; compact?: boolean }) {
  const { tr, fmtDateTime, fmtDate } = useI18n();
  if (!conflicts.length) return compact ? <Badge tone="success">{tr('لا تعارض', 'No conflicts')}</Badge>
    : <Notice tone="success" icon={<CheckCircle2 />}>{tr('لا توجد تعارضات مكتشفة لهذا الموعد.', 'No conflicts detected for this slot.')}</Notice>;
  if (compact) {
    return (
      <div className="row wrap" style={{ gap: 3 }}>
        {conflicts.map((c, i) => <Badge key={i} tone={TONE[c.severity]} title={conflictDetail(c, { tr, fmtDateTime, fmtDate }, benName)}>{tr(...(CONFLICT_LABEL[c.type] ?? [c.type, c.type]))}</Badge>)}
      </div>
    );
  }
  return (
    <ul className="list-plain">
      {conflicts.map((c, i) => (
        <li key={i} className="row start" style={{ gap: 8 }}>
          <Badge tone={TONE[c.severity]}>{tr(...(SEV[c.severity] ?? [c.severity, c.severity]))}</Badge>
          <div className="stack-sm" style={{ gap: 2 }}>
            <b className="small">{tr(...(CONFLICT_LABEL[c.type] ?? [c.type, c.type]))}</b>
            <span className="small muted">{conflictDetail(c, { tr, fmtDateTime, fmtDate }, benName)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
