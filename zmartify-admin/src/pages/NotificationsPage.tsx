import { useEffect, useMemo, useState } from 'react';
import {
  IonBadge,
  IonButton,
  IonContent,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonSpinner,
} from '@ionic/react';
import { notificationsApi, type MobileNotification } from '../api/notifications';
import { AppHeader } from '../components/AppHeader';

function toSiteKey(deviceId: string | undefined): string {
  if (!deviceId) return 'unknown';
  const parts = deviceId.split('-');
  return parts.length >= 2 ? parts.slice(0, 2).join('-') : deviceId;
}

export function NotificationsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notifications, setNotifications] = useState<MobileNotification[]>([]);
  const [deviceFilter, setDeviceFilter] = useState('all');
  const [siteFilter, setSiteFilter] = useState('all');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const rows = await notificationsApi.list({ limit: 200, unread_only: unreadOnly });
      setNotifications(rows);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [unreadOnly]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const deviceOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of notifications) {
      const deviceId = row.event.payload?.device_id;
      if (typeof deviceId === 'string' && deviceId) unique.add(deviceId);
    }
    return Array.from(unique).sort();
  }, [notifications]);

  const siteOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const deviceId of deviceOptions) unique.add(toSiteKey(deviceId));
    return Array.from(unique).sort();
  }, [deviceOptions]);

  const filtered = useMemo(() => {
    return notifications.filter((row) => {
      const deviceId = row.event.payload?.device_id;
      const matchesDevice = deviceFilter === 'all' || deviceId === deviceFilter;
      const matchesSite = siteFilter === 'all' || toSiteKey(typeof deviceId === 'string' ? deviceId : undefined) === siteFilter;
      return matchesDevice && matchesSite;
    });
  }, [notifications, deviceFilter, siteFilter]);

  const markRead = async (notificationId: string) => {
    try {
      await notificationsApi.markRead(notificationId);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const markAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <IonPage>
      <AppHeader title="Notifications" subtitle="Event feed and acknowledgement status" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <div className="flex flex-wrap justify-between items-center gap-2">
              <div>
                <p className="text-sm text-muted">Unread</p>{' '}
                <IonBadge color={unreadCount > 0 ? 'warning' : 'success'}>{unreadCount}</IonBadge>
              </div>
              <div className="flex gap-2">
                <IonButton size="small" fill="outline" onClick={() => setUnreadOnly((v) => !v)}>
                  {unreadOnly ? 'Show All' : 'Unread Only'}
                </IonButton>
                <IonButton size="small" onClick={markAllRead} disabled={unreadCount === 0}>
                  Mark All Read
                </IonButton>
              </div>
            </div>

            <div className="grid gap-2 mt-3">
              <IonItem>
                <IonLabel>Filter by Device</IonLabel>
                <IonSelect value={deviceFilter} onIonChange={(e) => setDeviceFilter(e.detail.value)} interface="popover">
                  <IonSelectOption value="all">All Devices</IonSelectOption>
                  {deviceOptions.map((deviceId) => (
                    <IonSelectOption key={deviceId} value={deviceId}>
                      {deviceId}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>
              <IonItem>
                <IonLabel>Filter by Site</IonLabel>
                <IonSelect value={siteFilter} onIonChange={(e) => setSiteFilter(e.detail.value)} interface="popover">
                  <IonSelectOption value="all">All Sites</IonSelectOption>
                  {siteOptions.map((siteId) => (
                    <IonSelectOption key={siteId} value={siteId}>
                      {siteId}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>
            </div>
          </section>

        {error && (
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-rose-200 text-rose-600 text-sm">{error}</section>
        )}

        {loading ? (
          <div className="flex items-center gap-2">
            <IonSpinner name="crescent" />
            <span>Loading notifications...</span>
          </div>
        ) : (
          <IonList>
            {filtered.map((row) => {
              const deviceId = row.event.payload?.device_id;
              const zoneId = row.event.payload?.zone_id;
              return (
                <IonItem key={row.notification_id}>
                  <IonLabel>
                    <strong>{row.event.event_type}</strong>
                    <p>{row.created_at}</p>
                    {deviceId ? <p>Device: {String(deviceId)}</p> : null}
                    {zoneId !== undefined ? <p>Zone: {String(zoneId)}</p> : null}
                    {!row.read ? <IonBadge color="warning">Unread</IonBadge> : <IonBadge color="success">Read</IonBadge>}
                  </IonLabel>
                  {!row.read && (
                    <IonButton slot="end" size="small" fill="outline" onClick={() => markRead(row.notification_id)}>
                      Mark Read
                    </IonButton>
                  )}
                </IonItem>
              );
            })}
            {!filtered.length && <IonItem><IonLabel>No notifications found.</IonLabel></IonItem>}
          </IonList>
        )}
        </div>
      </IonContent>
    </IonPage>
  );
}
