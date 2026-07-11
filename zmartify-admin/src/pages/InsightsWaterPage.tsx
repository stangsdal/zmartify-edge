import { useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { mobileApi, MobileEvent, MobileSiteSummary } from '../api/mobile';

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

  const metrics = useMemo(() => {
    const dailyWater = readMetric(events, ['water_liters', 'water_today_liters'], 1284);
    const flow = readMetric(events, ['flow_lpm', 'flow'], 31.2);
    const pressure = readMetric(events, ['pressure_bar', 'pressure'], 3.6);
    const runtime = Math.max(5, Math.round(dailyWater / Math.max(flow, 1)));
    return { dailyWater, flow, pressure, runtime };
  }, [events]);

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
