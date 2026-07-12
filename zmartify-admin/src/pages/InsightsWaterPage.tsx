import { useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { mobileApi, MobileEvent, MobileSiteSummary, subscribeRealtimeTopics } from '../api/mobile';

const parseNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readMetric = (events: MobileEvent[], keys: string[], fallback: number): number => {
  for (const event of events) {
    if (!event.payload || typeof event.payload !== 'object') continue;
    const payload = event.payload as Record<string, unknown>;
    for (const key of keys) {
      const direct = parseNumber(payload[key]);
      if (direct != null) return direct;
    }
    for (const value of Object.values(payload)) {
      if (!value || typeof value !== 'object') continue;
      const nested = value as Record<string, unknown>;
      for (const key of keys) {
        const parsed = parseNumber(nested[key]);
        if (parsed != null) return parsed;
      }
    }
  }
  return fallback;
};

export function InsightsWaterPage() {
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [overview, setOverview] = useState<any | null>(null);

  useEffect(() => {
    const load = async () => {
      const siteResponse = await mobileApi.listSites();
      setSites(siteResponse.sites || []);
      if ((siteResponse.sites || []).length) {
        setSelectedSite((prev) => prev || siteResponse.sites[0].site_id);
      }
      const eventResponse = await mobileApi.listEvents(160);
      setEvents(eventResponse.events || []);
    };
    load().catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedSite) return;

    let cleanup: (() => void) | undefined;

    const loadOverviewAndRealtime = async () => {
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
            event_id: `rt-water-${receivedAt}-${event.event_type}`,
            event_type: event.event_type,
            created_at: receivedAt,
            device_id: typeof event.payload?.device_id === 'string' ? event.payload.device_id : undefined,
            payload: event.payload,
          },
          ...prev,
        ].slice(0, 200));

        if (event.event_type === 'irrigation.status.updated' || event.event_type === 'irrigation.run.updated') {
          mobileApi
            .getIrrigationOverview(selectedSite)
            .then(setOverview)
            .catch(console.error);
        }
      });
    };

    loadOverviewAndRealtime().catch(console.error);

    return () => {
      cleanup?.();
    };
  }, [selectedSite]);

  const metrics = useMemo(() => {
    const devices = Array.isArray(overview?.devices) ? overview.devices : [];
    const flowValues = devices
      .map((device: any) => parseNumber(device?.hydraulics?.flow_lpm))
      .filter((value: number | null): value is number => value != null);
    const pressureValues = devices
      .map((device: any) => parseNumber(device?.hydraulics?.pressure_bar))
      .filter((value: number | null): value is number => value != null);
    const waterValues = devices
      .map((device: any) => parseNumber(device?.hydraulics?.water_liters))
      .filter((value: number | null): value is number => value != null);

    const dailyWater = waterValues.length
      ? waterValues.reduce((sum: number, value: number) => sum + value, 0)
      : readMetric(events, ['water_liters', 'water_today_liters'], 1284);
    const flow = flowValues.length
      ? flowValues.reduce((sum: number, value: number) => sum + value, 0) / flowValues.length
      : readMetric(events, ['flow_lpm', 'flow'], 31.2);
    const pressure = pressureValues.length
      ? pressureValues.reduce((sum: number, value: number) => sum + value, 0) / pressureValues.length
      : readMetric(events, ['pressure_bar', 'pressure'], 3.6);
    const runtime = Math.max(5, Math.round(dailyWater / Math.max(flow, 1)));
    return { dailyWater, flow, pressure, runtime };
  }, [events, overview]);

  return (
    <IonPage>
      <AppHeader title="Water Insights" subtitle="Consumption, hydraulics and runtime trends" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <SiteSelector
            label="Site"
            options={sites.map((site) => ({ site_id: site.site_id, site_name: site.site_name }))}
            value={selectedSite}
            onChange={setSelectedSite}
          />

          <section className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
              <p className="text-xs uppercase tracking-wide text-muted">Water today</p>
              <p className="text-2xl font-bold mt-1">{Math.round(metrics.dailyWater).toLocaleString()} L</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">Estimated runtime</p>
              <p className="text-2xl font-bold mt-1">{metrics.runtime} min</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--hvac">
              <p className="text-xs uppercase tracking-wide text-muted">Average flow</p>
              <p className="text-2xl font-bold mt-1">{metrics.flow.toFixed(1)} L/min</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">Average pressure</p>
              <p className="text-2xl font-bold mt-1">{metrics.pressure.toFixed(1)} bar</p>
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
