// Visual, interactive journey: horizontal stage nodes joined by progress lines,
// with flags for locks, approvals, required evidence, blockers and records.
import { AlertTriangle, Ban, Check, ListChecks, Lock, Paperclip, Play, ShieldCheck, SkipForward, Clock, Users } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { Badge, Progress } from '@/components/ui';
import { cx } from '@/utils/cx';
import type { StageInfo } from './journeyModel';

export function JourneyMap({ infos, selected, onSelect }: { infos: StageInfo[]; selected: string | null; onSelect: (key: string) => void }) {
  const { tr, pick, enumLabel, fmtDate } = useI18n();
  return (
    <div className="journey" role="list" aria-label={tr('رحلة البرنامج', 'Program journey')}>
      {infos.map((info, idx) => {
        const s = info.stage;
        const last = idx === infos.length - 1;
        const icon = s.status === 'completed' ? <Check /> : s.status === 'skipped' ? <SkipForward /> : s.status === 'blocked' ? <Ban />
          : info.locked ? <Lock /> : s.status === 'in_progress' ? <Play /> : <span>{idx + 1}</span>;
        const approvalTone = s.approval_status === 'approved' ? 'success' : s.approval_status === 'pending' ? 'warning' : s.approval_status === 'rejected' ? 'danger' : 'outline';
        return (
          <div key={s.id} role="listitem"
            className={cx('j-stage', s.status, info.locked && 'locked', selected === s.stage_key && 'selected')}
            tabIndex={0} aria-current={selected === s.stage_key ? 'step' : undefined}
            onClick={() => onSelect(s.stage_key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.stage_key); } }}
            title={info.locked ? tr('مقفلة: متطلبات سابقة غير مكتملة', 'Locked: prerequisites not complete') : undefined}>
            <div className="j-node">
              <span className="j-circle" aria-hidden>{icon}</span>
              {!last && <span className="j-line" aria-hidden />}
            </div>
            <div className="j-card">
              <span className="j-name">{pick(s.name_ar, s.name_en)}</span>
              <span className="tiny muted">{enumLabel('stageStatus', s.status)}{s.status === 'in_progress' ? ` · ${s.progress}%` : ''}</span>
              {s.status === 'in_progress' && <Progress value={s.progress} tone={info.overdue ? 'warning' : undefined} />}
              <div className="j-flags">
                {info.locked && <Badge tone="outline" icon={<Lock />} title={tr('متطلبات غير مكتملة', 'Unmet prerequisites')}>{info.unmet.length}</Badge>}
                {s.requires_approval && (
                  <Badge tone={approvalTone} icon={<ShieldCheck />} title={`${tr('يتطلب اعتمادًا', 'Requires approval')}: ${enumLabel('approvalStatus', s.approval_status)}`}>
                    {s.approval_status === 'pending' ? tr('معلّق', 'Pending') : s.approval_status === 'approved' ? tr('معتمد', 'OK') : tr('اعتماد', 'Appr.')}
                  </Badge>
                )}
                {info.evidence.length > 0 && (
                  <Badge tone={info.evidenceMissing ? (['in_progress', 'completed'].includes(s.status) ? 'warning' : 'outline') : 'success'} icon={<Paperclip />}
                    title={tr('الأدلة المطلوبة المستوفاة', 'Required evidence satisfied')}>
                    {info.evidence.length - info.evidenceMissing}/{info.evidence.length}
                  </Badge>
                )}
                {s.status === 'blocked' && <Badge tone="danger" icon={<AlertTriangle />} title={s.blocker_note ?? ''}>{tr('عائق', 'Blocker')}</Badge>}
                {info.overdue && <Badge tone="warning" icon={<Clock />}>{tr('متأخرة', 'Late')}</Badge>}
                {info.records > 0 && <Badge tone="info" icon={<ListChecks />} title={tr('سجلات المرحلة', 'Stage records')}>{info.records}</Badge>}
                {info.participants > 0 && <Badge tone="primary" icon={<Users />} title={tr('مستفيدون في هذه المرحلة', 'Beneficiaries at this stage')}>{info.participants}</Badge>}
              </div>
              {(s.planned_start || s.planned_end) && (
                <span className="tiny muted">{fmtDate(s.planned_start, { year: undefined, month: 'short', day: 'numeric' })} – {fmtDate(s.planned_end, { year: undefined, month: 'short', day: 'numeric' })}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
