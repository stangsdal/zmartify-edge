import { useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { motion } from 'framer-motion';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { mobileApi, MobileEvent, MobileSiteSummary, MobileZone } from '../api/mobile';
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
      const site = await mobileApi.getSite(selectedSite);
      const deviceDetails = await Promise.all(site.devices.map((d) => mobileApi.getDevice(d.device_id)));
      const allZones = deviceDetails.flatMap((d) => d.zones || []);
      setZones(allZones);
    };
    loadZones().catch(console.error);
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

  return (
    <IonPage>
      <AppHeader title="Home" subtitle="Comfort-first overview" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-8">
          <SiteSelector
            label="Property"
            options={sites.map((s) => ({ site_id: s.site_id, site_name: s.site_name }))}
            value={selectedSite}
            onChange={setSelectedSite}
          />

          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl p-6 hero-glow text-white"
            style={{ background: 'linear-gradient(135deg, #301E96 0%, #7D85FF 55%, #67FBFF 100%)' }}
          >
            <p className="text-sm opacity-90">Good day</p>
            <h1 className="text-3xl font-bold mt-1">Comfort Score {comfortScore}%</h1>
            <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
              <div>
                <p className="opacity-90">Indoor Average</p>
                <p className="text-xl font-semibold">{indoorAverage === null ? '--' : `${indoorAverage.toFixed(1)}°C`}</p>
              </div>
              <div>
                <p className="opacity-90">Rooms Heating</p>
                <p className="text-xl font-semibold">{heatingRooms}</p>
              </div>
            </div>
          </motion.section>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl app-surface p-3 shadow-soft">
              <p className="text-xs text-muted">Heating</p>
              <p className="text-xl font-bold text-brand-primary">{heatingRooms}</p>
            </div>
            <div className="rounded-2xl app-surface p-3 shadow-soft">
              <p className="text-xs text-muted">Offline</p>
              <p className="text-xl font-bold text-rose-600">{offlineRooms}</p>
            </div>
            <div className="rounded-2xl app-surface p-3 shadow-soft">
              <p className="text-xs text-muted">Alerts</p>
              <p className="text-xl font-bold text-amber-600">{unreadAlerts}</p>
            </div>
          </div>

          <section className="rounded-2xl app-surface p-4 shadow-soft">
            <h2 className="text-lg font-semibold mb-2">Recent Activity</h2>
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
