import { useEffect, useMemo, useState } from 'react';
import { IonButton, IonContent, IonPage } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { AlertCard } from '../components/AlertCard';
import { notificationsApi } from '../api/notifications';
import { mobileApi, MobileEvent, subscribeRealtimeTopics } from '../api/mobile';

function priorityFromEventType(eventType: string): 'critical' | 'warning' | 'info' {
  if (eventType.includes('fault') || eventType.includes('failed') || eventType.includes('offline')) return 'critical';
  if (eventType.includes('alarm') || eventType.includes('setpoint')) return 'warning';
  return 'info';
}

export function AlertsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [irrigationRows, setIrrigationRows] = useState<MobileEvent[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = async () => {
    const [data, sites] = await Promise.all([
      notificationsApi.list({ limit: 200, unread_only: unreadOnly }),
      mobileApi.listSites(),
    ]);
    setRows(data);

    const siteIds = (sites.sites || []).map((site) => site.site_id);
    const eventResponses = await Promise.all(siteIds.map((siteId) => mobileApi.listEvents(40, { siteId })));
    const nextIrrigationRows = eventResponses
      .flatMap((response) => response.events || [])
      .filter((event) => {
        const type = String(event.event_type || '').toLowerCase();
        return type.includes('irrigation') || type.includes('controller_fault');
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20);
    setIrrigationRows(nextIrrigationRows);
  };

  useEffect(() => {
    load().catch(console.error);
  }, [unreadOnly]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const connect = async () => {
      const sites = await mobileApi.listSites();
      const siteDetails = await Promise.all((sites.sites || []).map((site) => mobileApi.getSite(site.site_id)));
      const topics = siteDetails.flatMap((site) => site.devices.map((device) => `device:${device.device_id}:irrigation`));

      cleanup = subscribeRealtimeTopics(topics, (event) => {
        const receivedAt = new Date().toISOString();
        setIrrigationRows((prev) => {
          const next: MobileEvent = {
            event_id: `rt-alert-${receivedAt}-${event.event_type}`,
            event_type: event.event_type,
            created_at: receivedAt,
            device_id: typeof event.payload?.device_id === 'string' ? event.payload.device_id : undefined,
            payload: event.payload,
          };
          return [next, ...prev].slice(0, 20);
        });
      });
    };

    connect().catch(console.error);
    return () => cleanup?.();
  }, []);

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
  const irrigationCriticalCount = useMemo(
    () =>
      irrigationRows.filter((row) => {
        const severity = String(row.payload?.severity || '').toLowerCase();
        return severity === 'critical' || severity === 'alarm' || String(row.event_type).includes('fault');
      }).length,
    [irrigationRows]
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
            <div className="mt-4 rounded-xl p-3 border border-amber-200 bg-amber-50/70">
              <p className="text-xs uppercase tracking-wide text-muted">Irrigation realtime alarms</p>
              <p className="text-xl font-bold mt-1">{irrigationCriticalCount}</p>
              <p className="text-sm text-muted mt-1">Live outcome and status events from irrigation controllers.</p>
            </div>
          </div>

          <div className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-lg font-semibold">Irrigation drill-down</h2>
                <p className="text-sm text-muted">Latest status, alarm and command feedback events</p>
              </div>
            </div>
            <div className="space-y-3">
              {irrigationRows.map((row) => {
                const severity = String(row.payload?.severity || '').toLowerCase();
                const priority = severity === 'critical' || severity === 'alarm' ? 'critical' : severity === 'warning' ? 'warning' : 'info';
                const detailParts = [
                  row.device_id ? `Device ${row.device_id}` : null,
                  typeof row.payload?.detail === 'string' ? row.payload.detail : null,
                  typeof row.payload?.result === 'string' ? `Result ${row.payload.result}` : null,
                ].filter(Boolean);
                return (
                  <AlertCard
                    key={row.event_id}
                    title={row.event_type.replace(/_/g, ' ')}
                    detail={detailParts.join(' · ') || 'Irrigation event'}
                    time={row.created_at}
                    priority={priority}
                  />
                );
              })}
              {!irrigationRows.length ? <p className="text-sm text-muted">No irrigation events yet.</p> : null}
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
