import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Bell, CheckCheck } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { useAuth } from '@/app/AuthProvider';
import { list, rpc } from '@/services/db';
import { Button } from '@/components/ui';
import type { AppNotification } from '@/types/db';

export function NotificationsBell() {
  const { tr, fmtDateTime } = useI18n();
  const { org } = useOrg();
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    if (!user) return;
    try {
      const { rows } = await list<AppNotification>('notifications', {
        filters: [['organization_id', 'eq', org.id], ['user_id', 'eq', user.id], ['channel', 'eq', 'in_app'], ['status', 'in', ['sent', 'queued', 'scheduled', 'read']], ['scheduled_for', 'lte', new Date().toISOString()]],
        order: { column: 'scheduled_for' }, pageSize: 10,
      });
      setItems(rows);
    } catch { setItems([]); }
  };
  useEffect(() => { void load(); const t = setInterval(load, 60000); return () => clearInterval(t); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id, user?.id]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const unread = items.filter((i) => i.status !== 'read').length;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <Button variant="ghost" iconOnly icon={<Bell />} onClick={() => setOpen((o) => !o)} aria-label={tr('الإشعارات', 'Notifications')} />
      {unread > 0 && <span className="badge danger" style={{ position: 'absolute', top: -2, insetInlineEnd: -2, padding: '0 5px', fontSize: 10 }}>{unread}</span>}
      {open && (
        <div className="popover" style={{ insetInlineEnd: 0, top: 40, width: 340 }}>
          <div className="card-head"><h3>{tr('الإشعارات', 'Notifications')}</h3>
            <Button size="sm" variant="ghost" icon={<CheckCheck />} disabled={!unread} onClick={async () => { await rpc('mark_all_notifications_read', { p_org: org.id }); await load(); }}>{tr('تعليم الكل كمقروء', 'Mark all read')}</Button>
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {!items.length && <p className="muted small" style={{ padding: 14 }}>{tr('لا توجد إشعارات.', 'No notifications.')}</p>}
            {items.map((n) => (
              <div key={n.id} className="card-body" style={{ borderBottom: '1px solid var(--border)', background: n.status === 'read' ? undefined : 'var(--primary-tint)' }}>
                <div className="row between"><b className="small">{n.title}</b><span className="tiny muted">{fmtDateTime(n.scheduled_for)}</span></div>
                {n.body && <p className="small muted">{n.body}</p>}
                <div className="row">
                  {n.link && <Link className="small" to={n.link} onClick={() => setOpen(false)}>{tr('فتح', 'Open')}</Link>}
                  {n.status !== 'read' && <button className="link-btn small" onClick={async () => { await rpc('mark_notification_read', { p_id: n.id }); await load(); }}>{tr('تعليم كمقروء', 'Mark read')}</button>}
                </div>
              </div>
            ))}
          </div>
          <div className="card-foot"><Link to="/app/notifications" onClick={() => setOpen(false)}>{tr('كل الإشعارات', 'All notifications')}</Link></div>
        </div>
      )}
    </div>
  );
}
