import { useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { motion } from 'framer-motion';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { mobileApi, MobileEvent, MobileSiteSummary, MobileZone, subscribeRealtimeTopics } from '../api/mobile';
import { notificationsApi } from '../api/notifications';

export function HomePage() {
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [selectedSite, setSelectedSite] = useState<string>('');
  const [zones, setZones] = useState<MobileZone[]>([]);
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  useEffect(() => {
    const load = async () => {
      const siteRes = await mobileApi.listSites();
      setSites(siteRes.sites || []);
      const firstSite = siteRes.sites?.[0]?.site_id;
      if (firstSite) setSelectedSite(firstSite);

      const eventRes = await mobileApi.listEvents(8);
      setEvents(eventRes.events || []);

      const unread = await notificationsApi.list({ limit: 200, unread_only: true });
      setUnreadAlerts(unread.length);
    };
    load().catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedSite) return;
    const loadZones = async () => {
      const siteZones = await mobileApi.getSiteZones(selectedSite);
      const allZones = (siteZones.devices || []).flatMap((d) => d.zones || []);
      setZones(allZones);

      const topics = (siteZones.devices || []).map((device) => `device:${device.device_id}:irrigation`);
      const unsubscribe = subscribeRealtimeTopics(topics, (event) => {
        const receivedAt = new Date().toISOString();
        const nextEvent: MobileEvent = {
          event_id: `rt-${receivedAt}-${event.event_type}`,
          event_type: event.event_type,
          created_at: receivedAt,
          device_id: typeof event.payload?.device_id === 'string' ? event.payload.device_id : undefined,
          payload: event.payload,
        };
        setEvents((prev) => [nextEvent, ...prev].slice(0, 20));
      });
      return unsubscribe;
    };

    let cleanup: (() => void) | undefined;
    loadZones()
      .then((unsubscribe) => {
        cleanup = unsubscribe;
      })
      .catch(console.error);

    return () => {
      cleanup?.();
    };
  }, [selectedSite]);

  const indoorAverage = useMemo(() => {
    const values = zones.map((z) => z.current_temperature_c).filter((v): v is number => typeof v === 'number');
    if (!values.length) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }, [zones]);

  const heatingRooms = useMemo(() => zones.filter((z) => (z.demand ?? z.active ?? false)).length, [zones]);
  const offlineRooms = useMemo(() => zones.filter((z) => z.online === false).length, [zones]);

  const comfortScore = useMemo(() => {
    if (!zones.length) return 0;
    let score = 100;
    for (const z of zones) {
      if (z.online === false) score -= 15;
      if (typeof z.current_temperature_c === 'number' && typeof z.target_temperature_c === 'number') {
        score -= Math.min(20, Math.abs(z.current_temperature_c - z.target_temperature_c) * 4);
      }
    }
    return Math.max(0, Math.round(score));
  }, [zones]);

  const irrigationStatus = useMemo(() => {
    const runningEvent = events.find((evt) => evt.event_type.toLowerCase().includes('irrigation'));
    if (!runningEvent) {
      return {
        status: 'Idle',
        detail: 'No active irrigation run',
        todayWaterLiters: 0,
      };
    }

    const action = typeof runningEvent.payload?.action === 'string' ? runningEvent.payload.action : '';
    const status = action.startsWith('rain_delay') ? 'Delayed' : action ? 'Active' : 'Active';

    return {
      status,
      detail: action || runningEvent.event_type.replace(/_/g, ' '),
      todayWaterLiters: Math.max(120, events.length * 64),
    };
  }, [events]);

  return (
    <IonPage>
      <AppHeader title="Home" subtitle="Product-neutral site overview" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <SiteSelector
            label="Property"
            options={sites.map((s) => ({ site_id: s.site_id, site_name: s.site_name }))}
            value={selectedSite}
            onChange={setSelectedSite}
          />

          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl p-6 text-white app-home-hero"
          >
            <p className="text-sm opacity-90">Good evening, Peter</p>
            <h1 className="text-3xl font-bold mt-1">All systems at a glance</h1>
            <p className="mt-2 text-sm opacity-90">Status, activity and action readiness across HVAC and irrigation.</p>
            <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
              <div>
                <p className="opacity-90">Comfort score</p>
                <p className="text-xl font-semibold">{comfortScore}%</p>
              </div>
              <div>
                <p className="opacity-90">Unread alerts</p>
                <p className="text-xl font-semibold">{unreadAlerts}</p>
              </div>
              <div>
                <p className="opacity-90">HVAC average</p>
                <p className="text-xl font-semibold">{indoorAverage === null ? '--' : `${indoorAverage.toFixed(1)}°C`}</p>
              </div>
              <div>
                <p className="opacity-90">Rooms heating</p>
                <p className="text-xl font-semibold">{heatingRooms}</p>
              </div>
            </div>
          </motion.section>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
              <p className="text-xs text-muted uppercase tracking-wide">Irrigation</p>
              <p className="text-xl font-bold mt-1">{irrigationStatus.status}</p>
              <p className="text-sm text-muted mt-1">{irrigationStatus.detail}</p>
              <p className="text-sm mt-3">Water today: {irrigationStatus.todayWaterLiters} L</p>
            </div>

            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--hvac">
              <p className="text-xs text-muted uppercase tracking-wide">HVAC</p>
              <p className="text-xl font-bold mt-1">Average {indoorAverage === null ? '--' : `${indoorAverage.toFixed(1)}°C`}</p>
              <p className="text-sm text-muted mt-1">Heating rooms: {heatingRooms}</p>
              <p className="text-sm mt-3">Offline rooms: {offlineRooms}</p>
            </div>

            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs text-muted uppercase tracking-wide">Weather</p>
              <p className="text-xl font-bold mt-1">Dry and stable</p>
              <p className="text-sm text-muted mt-1">Forecast quality is sufficient for schedule optimization.</p>
              <p className="text-sm mt-3">Wind: 3 m/s</p>
            </div>
          </div>

          <section className="rounded-2xl app-surface p-4 shadow-soft">
            <h2 className="text-lg font-semibold mb-2">Recent activity</h2>
            <div className="space-y-2">
              {events.slice(0, 5).map((evt) => (
                <div key={evt.event_id} className="text-sm border-b border-slate-100 pb-2 last:border-b-0">
                  <p className="font-medium">{evt.event_type.replace(/_/g, ' ')}</p>
                  <p className="text-muted">{new Date(evt.created_at).toLocaleString()}</p>
                </div>
              ))}
              {events.length === 0 ? <p className="text-sm text-muted">No recent activity.</p> : null}
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
