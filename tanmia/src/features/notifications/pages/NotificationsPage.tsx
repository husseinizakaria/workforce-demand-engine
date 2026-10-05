// The user's in-app notifications, and (for notifications.configure) the
// organization delivery log with a manual "dispatch due now" trigger.
import { useState } from 'react';
import { Link } from 'react-router';
import { Bell, CheckCheck, Eye, Inbox, Send, ServerCog } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAuth } from '@/app/AuthProvider';
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, Drawer, Notice, PageHeader, Segmented, Select, StatusBadge, Tabs, useToast, type Column,
} from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { list, rpc, type Filter } from '@/services/db';
import { callFunction } from '@/services/functions';
import { errorOf, type AppError } from '@/services/errors';
import type { AppNotification } from '@/types/db';

const PAGE = 25;
const UNAVAILABLE = new Set(['function_unavailable', 'not_configured', '404']);

export default function NotificationsPage() {
  const { tr } = useI18n();
  const { can } = useOrg();
  const [tab, setTab] = useState('inbox');
  const admin = can('notifications.configure');
  return (
    <div className="stack">
      <PageHeader title={tr('الإشعارات', 'Notifications')} subtitle={tr('إشعاراتك داخل المنصة وسجل التسليم عبر القنوات.', 'Your in-app notifications and the multi-channel delivery log.')} />
      {admin && <Tabs value={tab} onChange={setTab} items={[
        { key: 'inbox', label: tr('صندوقي', 'My inbox'), icon: <Inbox /> },
        { key: 'log', label: tr('سجل التسليم', 'Delivery log'), icon: <ServerCog /> },
      ]} />}
      {tab === 'log' && admin ? <DeliveryLog /> : <MyInbox />}
    </div>
  );
}

function MyInbox() {
  const { tr, fmtDateTime, enumLabel, locale } = useI18n();
  const { org } = useOrg();
  const { user } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [page, setPage] = useState(0);
  const state = useAsync(() => {
    const f: Filter[] = [['organization_id', 'eq', org.id], ['user_id', 'eq', user?.id ?? ''], ['channel', 'eq', 'in_app'], ['scheduled_for', 'lte', new Date().toISOString()]];
    f.push(['status', 'in', filter === 'read' ? ['read'] : filter === 'unread' ? ['sent', 'queued', 'scheduled'] : ['sent', 'queued', 'scheduled', 'read']]);
    return list<AppNotification>('notifications', { filters: f, order: { column: 'scheduled_for' }, page, pageSize: PAGE, count: true });
  }, [org.id, user?.id, filter, page]);
  const err = (e: unknown) => { const ae = errorOf(e); toast.error(locale === 'ar' ? ae.message_ar : ae.message_en); };
  const markRead = async (n: AppNotification) => {
    try { await rpc('mark_notification_read', { p_id: n.id }); await state.reload(); } catch (e) { err(e); }
  };
  const markAll = async () => {
    try { const n = await rpc<number>('mark_all_notifications_read', { p_org: org.id }); toast.success(tr(`عُلّم ${n ?? 0} إشعار كمقروء`, `${n ?? 0} notifications marked read`)); await state.reload(); }
    catch (e) { err(e); }
  };
  const columns: Column<AppNotification>[] = [
    { key: 'state', header: '', render: (n) => n.status !== 'read' ? <Badge tone="primary">{tr('جديد', 'New')}</Badge> : <span className="tiny muted">{tr('مقروء', 'Read')}</span> },
    { key: 'title', header: tr('الإشعار', 'Notification'), render: (n) => (
      <div className="stack-sm" style={{ gap: 2 }}>
        <b className={n.status === 'read' ? 'small muted' : 'small'}>{n.title}</b>
        {n.body && <span className="tiny muted">{n.body}</span>}
      </div>
    ) },
    { key: 'event', header: tr('الحدث', 'Event'), value: (n) => enumLabel('eventType', n.event_type) },
    { key: 'when', header: tr('الوقت', 'Time'), value: (n) => n.scheduled_for, render: (n) => <span className="small nowrap">{fmtDateTime(n.scheduled_for)}</span> },
    { key: 'actions', header: '', render: (n) => (
      <div className="row" style={{ gap: 6 }}>
        {n.link && <Link className="small" to={n.link} onClick={() => { if (n.status !== 'read') void rpc('mark_notification_read', { p_id: n.id }).catch(() => undefined); }}>{tr('فتح', 'Open')}</Link>}
        {n.status !== 'read' && <Button size="sm" variant="ghost" onClick={() => void markRead(n)}>{tr('تعليم كمقروء', 'Mark read')}</Button>}
      </div>
    ) },
  ];
  return (
    <Card>
      <CardHeader title={tr('إشعاراتي', 'My notifications')} icon={<Bell />}
        actions={<Button size="sm" icon={<CheckCheck />} onClick={() => void markAll()}>{tr('تعليم الكل كمقروء', 'Mark all read')}</Button>} />
      <CardBody flush>
        <DataTable columns={columns} rows={state.data?.rows ?? []} rowKey={(n) => n.id} loading={state.loading} error={state.error} onRetry={() => void state.reload()}
          toolbar={<Segmented value={filter} onChange={(v) => { setFilter(v); setPage(0); }} options={[
            { value: 'all', label: tr('الكل', 'All') }, { value: 'unread', label: tr('غير المقروء', 'Unread') }, { value: 'read', label: tr('المقروء', 'Read') }]} />}
          server={{ page, pageSize: PAGE, total: state.data?.total ?? null, onPage: setPage }}
          empty={{ title: filter === 'unread' ? tr('لا توجد إشعارات غير مقروءة', 'No unread notifications') : tr('لا توجد إشعارات', 'No notifications') }} />
      </CardBody>
    </Card>
  );
}

interface DispatchResult { processed: number; sent: number; failed: number; skipped: number }
interface ProviderStatus { email: boolean; sms: boolean; whatsapp: boolean }

function DeliveryLog() {
  const { tr, fmtDateTime, enumLabel, enumOptions, fmtNumber, locale } = useI18n();
  const { org } = useOrg();
  const toast = useToast();
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<AppNotification | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DispatchResult | null>(null);
  const [fnErr, setFnErr] = useState<AppError | null>(null);
  const state = useAsync(() => {
    const f: Filter[] = [['organization_id', 'eq', org.id]];
    if (channel) f.push(['channel', 'eq', channel]);
    if (status) f.push(['status', 'eq', status]);
    return list<AppNotification>('notifications', { filters: f, order: { column: 'created_at' }, page, pageSize: PAGE, count: true });
  }, [org.id, channel, status, page]);
  const providers = useAsync(async () => {
    try { return await callFunction<ProviderStatus>('dispatch-notification', { action: 'status' }); } catch { return null; }
  }, []);
  const dispatch = async () => {
    setBusy(true); setFnErr(null);
    try {
      const r = await callFunction<DispatchResult>('dispatch-notification', { organization_id: org.id });
      setResult(r); toast.success(tr('تمت معالجة الإشعارات المستحقة', 'Due notifications processed')); await state.reload();
    } catch (e) {
      const ae = errorOf(e);
      if (UNAVAILABLE.has(ae.code)) setFnErr(ae); else toast.error(locale === 'ar' ? ae.message_ar : ae.message_en);
    } finally { setBusy(false); }
  };
  const resultSummary = (n: AppNotification): string => {
    const r = n.delivery_result ?? {};
    const parts = ['reason', 'error', 'provider', 'message_id'].map((k) => (r[k] !== undefined && r[k] !== null ? `${k}: ${String(r[k])}` : null)).filter(Boolean);
    return parts.join(' · ');
  };
  const columns: Column<AppNotification>[] = [
    { key: 'created', header: tr('أُنشئ', 'Created'), value: (n) => n.created_at, render: (n) => <span className="small nowrap">{fmtDateTime(n.created_at)}</span> },
    { key: 'scheduled', header: tr('مجدول لـ', 'Scheduled for'), value: (n) => n.scheduled_for, render: (n) => <span className="small nowrap">{fmtDateTime(n.scheduled_for)}</span> },
    { key: 'channel', header: tr('القناة', 'Channel'), value: (n) => enumLabel('channel', n.channel), render: (n) => <Badge tone="outline">{enumLabel('channel', n.channel)}</Badge> },
    { key: 'recipient', header: tr('المستلم', 'Recipient'), value: (n) => n.recipient_email ?? n.recipient_phone ?? n.user_id ?? '',
      render: (n) => <span className="small ltr">{n.recipient_email ?? n.recipient_phone ?? (n.user_id ? tr('مستخدم داخل المنصة', 'Platform user') : '—')}</span> },
    { key: 'event', header: tr('الحدث', 'Event'), value: (n) => enumLabel('eventType', n.event_type) },
    { key: 'title', header: tr('العنوان', 'Title'), value: (n) => n.title, render: (n) => <span className="small">{n.title}</span> },
    { key: 'status', header: tr('الحالة', 'Status'), value: (n) => n.status, render: (n) => <StatusBadge group="notificationStatus" value={n.status} /> },
    { key: 'attempts', header: tr('المحاولات', 'Attempts'), align: 'end', value: (n) => n.attempts },
    { key: 'result', header: tr('نتيجة التسليم', 'Delivery result'), value: resultSummary, render: (n) => <span className="tiny muted">{resultSummary(n) || '—'}</span> },
    { key: 'open', header: '', hideInExport: true, render: (n) => <Button size="sm" variant="ghost" iconOnly icon={<Eye />} aria-label={tr('تفاصيل', 'Details')} onClick={() => setOpen(n)} /> },
  ];
  return (
    <div className="stack">
      <Card>
        <CardHeader title={tr('الإرسال', 'Dispatch')} icon={<Send />}
          actions={<Button variant="primary" icon={<Send />} loading={busy} onClick={dispatch}>{tr('إرسال المستحق الآن', 'Dispatch due now')}</Button>} />
        <CardBody>
          <div className="stack-sm">
            <p className="small muted">{tr('يعالج الإشعارات المجدولة التي حان موعدها لهذه المؤسسة. القنوات غير المهيأة تُسجَّل «تم تخطيه» مع السبب — لا يُدّعى إرسال لم يحدث.', 'Processes scheduled notifications that are due for this organization. Unconfigured channels are recorded as “skipped” with a reason — no delivery is faked.')}</p>
            {providers.data && (
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="small">{tr('حالة المزودين', 'Provider status')}:</span>
                <Badge tone="success">{enumLabel('channel', 'in_app')}</Badge>
                {(['email', 'sms', 'whatsapp'] as const).map((k) => <Badge key={k} tone={providers.data![k] ? 'success' : 'neutral'}>{enumLabel('channel', k)}: {providers.data![k] ? tr('مهيأ', 'configured') : tr('غير مهيأ', 'not configured')}</Badge>)}
              </div>
            )}
            {fnErr && <Notice tone="warning">{locale === 'ar' ? fnErr.message_ar : fnErr.message_en} {tr('لم يُرسل أي إشعار.', 'No notifications were sent.')}</Notice>}
            {result && <Notice tone={result.failed ? 'warning' : 'success'}>{tr('عولج', 'Processed')} {fmtNumber(result.processed)} · {tr('أُرسل', 'sent')} {fmtNumber(result.sent)} · {tr('فشل', 'failed')} {fmtNumber(result.failed)} · {tr('تم تخطيه', 'skipped')} {fmtNumber(result.skipped)}</Notice>}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={tr('سجل تسليم الإشعارات', 'Notification delivery log')} icon={<ServerCog />} />
        <CardBody flush>
          <DataTable columns={columns} rows={state.data?.rows ?? []} rowKey={(n) => n.id} loading={state.loading} error={state.error} onRetry={() => void state.reload()}
            exportName="notification-log" server={{ page, pageSize: PAGE, total: state.data?.total ?? null, onPage: setPage }}
            toolbar={<>
              <Select aria-label={tr('القناة', 'Channel')} options={enumOptions('channel')} placeholder={tr('كل القنوات', 'All channels')} value={channel} onChange={(e) => { setChannel(e.target.value); setPage(0); }} style={{ maxWidth: 170 }} />
              <Select aria-label={tr('الحالة', 'Status')} options={enumOptions('notificationStatus')} placeholder={tr('كل الحالات', 'All statuses')} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} style={{ maxWidth: 170 }} />
            </>}
            empty={{ title: tr('لا توجد إشعارات', 'No notifications') }} />
        </CardBody>
      </Card>
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ''}>
        {open && (
          <div className="stack">
            <dl className="kv">
              <dt>{tr('القناة', 'Channel')}</dt><dd>{enumLabel('channel', open.channel)}</dd>
              <dt>{tr('الحالة', 'Status')}</dt><dd><StatusBadge group="notificationStatus" value={open.status} /></dd>
              <dt>{tr('الحدث', 'Event')}</dt><dd>{enumLabel('eventType', open.event_type)}</dd>
              <dt>{tr('مجدول لـ', 'Scheduled for')}</dt><dd>{fmtDateTime(open.scheduled_for)}</dd>
              <dt>{tr('أُرسل', 'Sent')}</dt><dd>{fmtDateTime(open.sent_at)}</dd>
              <dt>{tr('قُرئ', 'Read')}</dt><dd>{fmtDateTime(open.read_at)}</dd>
              <dt>{tr('المحاولات', 'Attempts')}</dt><dd>{open.attempts}</dd>
              <dt>{tr('المستلم', 'Recipient')}</dt><dd className="ltr">{open.recipient_email ?? open.recipient_phone ?? open.user_id ?? '—'}</dd>
            </dl>
            {open.body && <p className="small">{open.body}</p>}
            <div>
              <h4 className="small strong">{tr('نتيجة التسليم', 'Delivery result')}</h4>
              <pre className="mono tiny ltr" style={{ whiteSpace: 'pre-wrap', background: 'var(--bg)', padding: 8, borderRadius: 6 }}>{JSON.stringify(open.delivery_result ?? {}, null, 2)}</pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
