import { useEffect, useMemo, useState } from 'react';
import { IonButton, IonContent, IonPage } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { AlertCard } from '../components/AlertCard';
import { notificationsApi } from '../api/notifications';

function priorityFromEventType(eventType: string): 'critical' | 'warning' | 'info' {
  if (eventType.includes('fault') || eventType.includes('failed') || eventType.includes('offline')) return 'critical';
  if (eventType.includes('alarm') || eventType.includes('setpoint')) return 'warning';
  return 'info';
}

export function AlertsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = async () => {
    const data = await notificationsApi.list({ limit: 200, unread_only: unreadOnly });
    setRows(data);
  };

  useEffect(() => {
    load().catch(console.error);
  }, [unreadOnly]);

  const unreadCount = useMemo(() => rows.filter((r) => !r.read).length, [rows]);
  const criticalCount = useMemo(
    () => rows.filter((r) => priorityFromEventType(String(r.event?.event_type || '')) === 'critical').length,
    [rows]
  );
  const warningCount = useMemo(
    () => rows.filter((r) => priorityFromEventType(String(r.event?.event_type || '')) === 'warning').length,
    [rows]
  );
  const infoCount = useMemo(
    () => rows.filter((r) => priorityFromEventType(String(r.event?.event_type || '')) === 'info').length,
    [rows]
  );

  return (
    <IonPage>
      <AppHeader title="Alerts" subtitle="Actionable incidents and notifications" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <div className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm text-muted">Unread</p>
                <p className="text-2xl font-bold text-brand-primary">{unreadCount}</p>
              </div>
              <div className="flex gap-2">
                <IonButton size="small" fill="outline" onClick={() => setUnreadOnly((v) => !v)}>
                  {unreadOnly ? 'Show all' : 'Unread only'}
                </IonButton>
                <IonButton size="small" onClick={() => notificationsApi.markAllRead().then(load)}>
                  Mark all read
                </IonButton>
              </div>
            </div>

            <div className="grid gap-3 grid-cols-3 mt-4">
              <div className="rounded-xl p-3 app-system-card app-system-card--hvac">
                <p className="text-xs uppercase tracking-wide text-muted">Critical</p>
                <p className="text-xl font-bold mt-1">{criticalCount}</p>
              </div>
              <div className="rounded-xl p-3 app-system-card app-system-card--irrigation">
                <p className="text-xs uppercase tracking-wide text-muted">Warning</p>
                <p className="text-xl font-bold mt-1">{warningCount}</p>
              </div>
              <div className="rounded-xl p-3 app-system-card app-system-card--weather">
                <p className="text-xs uppercase tracking-wide text-muted">Info</p>
                <p className="text-xl font-bold mt-1">{infoCount}</p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.notification_id}>
                <AlertCard
                  title={row.event.event_type.replaceAll('_', ' ')}
                  detail={row.event.payload?.device_id ? `Device ${row.event.payload.device_id}` : 'System event'}
                  time={row.created_at}
                  priority={priorityFromEventType(row.event.event_type)}
                />
                {!row.read ? (
                  <div className="mt-2">
                    <IonButton size="small" fill="outline" onClick={() => notificationsApi.markRead(row.notification_id).then(load)}>
                      Mark read
                    </IonButton>
                  </div>
                ) : null}
              </div>
            ))}
            {!rows.length ? <p className="text-sm text-muted">No alerts found.</p> : null}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
