import { useEffect, useMemo, useState } from 'react';
import { IonContent, IonIcon, IonPage } from '@ionic/react';
import { cloudyOutline, partlySunnyOutline, rainyOutline, snowOutline, sunnyOutline, thunderstormOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { mobileApi, MobileEvent, MobileSiteWeather, MobileZone, subscribeRealtimeTopics } from '../api/mobile';
import { notificationsApi } from '../api/notifications';
import { useAccess } from '../auth/AccessContext';

export function HomePage() {
  const { context, selectedSiteId, selectSite } = useAccess();
  const [zones, setZones] = useState<MobileZone[]>([]);
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [weather, setWeather] = useState<MobileSiteWeather | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      const eventRes = await mobileApi.listEvents(8);
      setEvents(eventRes.events || []);

      const unread = await notificationsApi.list({ limit: 200, unread_only: true });
      setUnreadAlerts(unread.length);
    };
    load().catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedSiteId) return;
    const loadZones = async () => {
      const siteZones = await mobileApi.getSiteZones(String(selectedSiteId));
      const allZones = (siteZones.devices || []).flatMap((device) => (
        (device.zones || []).map((zone) => ({ ...zone, device_id: device.device_id }))
      ));
      setZones(allZones);
      return siteZones;
    };

    const subscribe = async () => {
      const siteZones = await loadZones();

      const topics = (siteZones.devices || []).flatMap((device) => [
        `device:${device.device_id}:irrigation`,
        `device:${device.device_id}:state`,
      ]);
      const unsubscribe = subscribeRealtimeTopics(topics, (event) => {
        const updatedZone = event.payload?.zone as MobileZone | undefined;
        if (event.event_type === 'device.state.updated' && updatedZone?.zone_id != null) {
          const deviceId = typeof event.payload?.device_id === 'string' ? event.payload.device_id : null;
          setZones((previous) => previous.map((zone) => (
            zone.zone_id === updatedZone.zone_id && (!deviceId || zone.device_id === deviceId)
              ? { ...zone, ...updatedZone }
              : zone
          )));
        }
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
    let refreshTimer: number | undefined;
    subscribe()
      .then((unsubscribe) => {
        cleanup = unsubscribe;
        refreshTimer = window.setInterval(() => {
          loadZones().catch(console.error);
        }, 10000);
      })
      .catch(console.error);

    return () => {
      cleanup?.();
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
    };
  }, [selectedSiteId]);

  useEffect(() => {
    if (!selectedSiteId) {
      setWeather(null);
      return;
    }
    const loadWeather = async () => {
      setWeatherLoading(true);
      try {
        setWeather(await mobileApi.getSiteWeather(String(selectedSiteId)));
      } catch {
        setWeather(null);
      } finally {
        setWeatherLoading(false);
      }
    };
    void loadWeather();
    const refreshTimer = window.setInterval(() => { void loadWeather(); }, 15 * 60 * 1000);
    return () => window.clearInterval(refreshTimer);
  }, [selectedSiteId]);

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

  const weatherSummary = useMemo(() => {
    const current = weather?.current;
    const temperatures = (weather?.forecast || [])
      .map((point) => point.temperature_c)
      .filter((value): value is number => typeof value === 'number');
    const precipitation = (weather?.forecast || []).reduce(
      (total, point) => total + (typeof point.precipitation_mm === 'number' ? point.precipitation_mm : 0),
      0,
    );
    const code = current?.weather_code;
    if (typeof code !== 'number') {
      return { current, temperatures, precipitation, label: 'Weather unavailable', icon: cloudyOutline };
    }
    if (code === 0) return { current, temperatures, precipitation, label: 'Clear', icon: sunnyOutline };
    if (code <= 3) return { current, temperatures, precipitation, label: 'Partly cloudy', icon: partlySunnyOutline };
    if (code >= 95) return { current, temperatures, precipitation, label: 'Thunderstorm', icon: thunderstormOutline };
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
      return { current, temperatures, precipitation, label: 'Snow', icon: snowOutline };
    }
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
      return { current, temperatures, precipitation, label: 'Rain', icon: rainyOutline };
    }
    return { current, temperatures, precipitation, label: 'Cloudy', icon: cloudyOutline };
  }, [weather]);

  return (
    <IonPage>
      <AppHeader title="Home" subtitle="Product-neutral site overview" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <SiteSelector
            label="Property"
            options={(context?.sites || []).map((site) => ({ site_id: String(site.id), site_name: site.name }))}
            value={selectedSiteId ? String(selectedSiteId) : ''}
            onChange={(siteId) => selectSite(Number(siteId))}
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
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted uppercase tracking-wide">Weather</p>
                  <p className="text-xl font-bold mt-1">
                    {weatherSummary.current?.temperature_c == null
                      ? (weatherLoading ? 'Loading...' : '--')
                      : `${weatherSummary.current.temperature_c.toFixed(1)}°C`}
                  </p>
                  <p className="text-sm text-muted mt-1">{weatherSummary.label}</p>
                </div>
                <IonIcon icon={weatherSummary.icon} className="text-3xl text-amber-500" aria-hidden="true" />
              </div>
              {weatherSummary.current ? (
                <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                  <div>
                    <p className="text-xs text-muted">Feels like</p>
                    <p className="font-semibold">
                      {weatherSummary.current.apparent_temperature_c == null ? '--' : `${weatherSummary.current.apparent_temperature_c.toFixed(1)}°C`}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Rain · 12h</p>
                    <p className="font-semibold">{weatherSummary.precipitation.toFixed(1)} mm</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Wind</p>
                    <p className="font-semibold">
                      {weatherSummary.current.wind_speed_kmh == null ? '--' : `${weatherSummary.current.wind_speed_kmh.toFixed(0)} km/h`}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted mt-3">
                  {weatherLoading ? 'Fetching local forecast...' : 'Verify the site address to enable local weather.'}
                </p>
              )}
              {weatherSummary.temperatures.length > 0 ? (
                <p className="text-sm mt-3">
                  Next 12h: {Math.min(...weatherSummary.temperatures).toFixed(0)}–{Math.max(...weatherSummary.temperatures).toFixed(0)}°C
                </p>
              ) : null}
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
