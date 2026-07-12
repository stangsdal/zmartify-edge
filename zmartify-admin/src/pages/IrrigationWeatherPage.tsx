import { useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { IrrigationSiteOverview, mobileApi, MobileEvent, MobileSiteSummary, subscribeRealtimeTopics } from '../api/mobile';

const parseNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const metric = (events: MobileEvent[], keys: string[], fallback: number): number => {
  for (const event of events) {
    if (!event.payload || typeof event.payload !== 'object') continue;
    const payload = event.payload as Record<string, unknown>;
    for (const key of keys) {
      const direct = parseNumber(payload[key]);
      if (direct != null) return direct;
    }
  }
  return fallback;
};

export function IrrigationWeatherPage() {
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [overview, setOverview] = useState<IrrigationSiteOverview | null>(null);

  useEffect(() => {
    const load = async () => {
      const siteResponse = await mobileApi.listSites();
      setSites(siteResponse.sites || []);
      if ((siteResponse.sites || []).length) {
        setSelectedSite((prev) => prev || siteResponse.sites[0].site_id);
      }
      const eventResponse = await mobileApi.listEvents(100);
      setEvents(eventResponse.events || []);
    };
    load().catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedSite) return;

    let cleanup: (() => void) | undefined;
    const loadRealtime = async () => {
      const [site, irrigationOverview] = await Promise.all([
        mobileApi.getSite(selectedSite),
        mobileApi.getIrrigationOverview(selectedSite),
      ]);
      setOverview(irrigationOverview);
      const topics = site.devices.map((device) => `device:${device.device_id}:irrigation`);
      cleanup = subscribeRealtimeTopics(topics, (event) => {
        const receivedAt = new Date().toISOString();
        setEvents((prev) => [
          {
            event_id: `rt-weather-${receivedAt}-${event.event_type}`,
            event_type: event.event_type,
            created_at: receivedAt,
            device_id: typeof event.payload?.device_id === 'string' ? event.payload.device_id : undefined,
            payload: event.payload,
          },
          ...prev,
        ].slice(0, 120));
        void mobileApi.getIrrigationOverview(selectedSite).then(setOverview).catch(console.error);
      });
    };

    loadRealtime().catch(console.error);
    return () => cleanup?.();
  }, [selectedSite]);

  const weather = useMemo(() => {
    const summary = overview?.devices?.[0]?.weather;
    const temperatureC = summary?.temperature_c ?? metric(events, ['temperature_c', 'outside_temp_c'], 18.4);
    const rainMm = summary?.rain_mm ?? metric(events, ['rain_mm', 'rain_today_mm'], 0.0);
    const windMps = summary?.wind_mps ?? metric(events, ['wind_mps', 'wind_speed_mps'], 3.1);
    const etoMm = summary?.eto_mm ?? metric(events, ['eto_mm', 'evapotranspiration_mm'], 2.8);
    return { temperatureC, rainMm, windMps, etoMm };
  }, [events, overview]);

  const rainDelay = useMemo(() => overview?.devices?.find((device) => device.rain_delay)?.rain_delay ?? null, [overview]);
  const outputFaults = useMemo(
    () => (overview?.devices || []).reduce((sum, device) => sum + (device.outputs?.faulted || 0), 0),
    [overview]
  );

  return (
    <IonPage>
      <AppHeader title="Weather" subtitle="Local weather inputs for schedule optimization" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <SiteSelector
            label="Site"
            options={sites.map((site) => ({ site_id: site.site_id, site_name: site.site_name }))}
            value={selectedSite}
            onChange={setSelectedSite}
          />

          <section className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">Air temperature</p>
              <p className="text-2xl font-bold mt-1">{weather.temperatureC.toFixed(1)}°C</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
              <p className="text-xs uppercase tracking-wide text-muted">Rain today</p>
              <p className="text-2xl font-bold mt-1">{weather.rainMm.toFixed(1)} mm</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--hvac">
              <p className="text-xs uppercase tracking-wide text-muted">Wind</p>
              <p className="text-2xl font-bold mt-1">{weather.windMps.toFixed(1)} m/s</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">ETO</p>
              <p className="text-2xl font-bold mt-1">{weather.etoMm.toFixed(1)} mm</p>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-2">
            <div className={`rounded-2xl app-surface p-4 shadow-soft border ${rainDelay ? 'border-amber-300 bg-amber-50/60' : 'border-slate-100'}`}>
              <p className="text-xs uppercase tracking-wide text-muted">Rain delay</p>
              <p className="text-xl font-bold mt-1">{rainDelay ? 'Active' : 'Inactive'}</p>
              <p className="text-sm text-muted mt-1">
                {rainDelay ? `Until ${new Date(rainDelay.active_until || '').toLocaleString()}` : 'No active rain hold'}
              </p>
              {rainDelay?.reason ? <p className="text-sm mt-2">Reason: {rainDelay.reason}</p> : null}
            </div>

            <div className={`rounded-2xl app-surface p-4 shadow-soft border ${outputFaults > 0 ? 'border-rose-300 bg-rose-50/60' : 'border-slate-100'}`}>
              <p className="text-xs uppercase tracking-wide text-muted">Output alarms</p>
              <p className="text-xl font-bold mt-1">{outputFaults}</p>
              <p className="text-sm text-muted mt-1">
                {outputFaults > 0 ? 'At least one irrigation output is faulted.' : 'No active output faults.'}
              </p>
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
