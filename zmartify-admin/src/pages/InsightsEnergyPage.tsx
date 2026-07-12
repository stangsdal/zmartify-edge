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

export function InsightsEnergyPage() {
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
    const voltage = readMetric(events, ['voltage_rms_v', 'voltage_v'], 24.3);
    const current = readMetric(events, ['current_rms_a', 'current_a'], 0.86);
    const apparentPower = readMetric(events, ['apparent_power_va', 'power_va'], voltage * current);
    const realPower = readMetric(events, ['real_power_w', 'power_w'], apparentPower * 0.79);
    const powerFactor = readMetric(events, ['power_factor'], realPower / Math.max(apparentPower, 1));
    const loadPercent = readMetric(events, ['transformer_load_percent'], Math.min(95, apparentPower / 60 * 100));
    return { voltage, current, apparentPower, realPower, powerFactor, loadPercent };
  }, [events]);

  return (
    <IonPage>
      <AppHeader title="Energy Insights" subtitle="Transformer load and valve power profile" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <SiteSelector
            label="Site"
            options={sites.map((site) => ({ site_id: site.site_id, site_name: site.site_name }))}
            value={selectedSite}
            onChange={setSelectedSite}
          />

          <section className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--hvac">
              <p className="text-xs uppercase tracking-wide text-muted">Voltage</p>
              <p className="text-2xl font-bold mt-1">{metrics.voltage.toFixed(1)} V</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">Current</p>
              <p className="text-2xl font-bold mt-1">{metrics.current.toFixed(2)} A</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
              <p className="text-xs uppercase tracking-wide text-muted">Load</p>
              <p className="text-2xl font-bold mt-1">{Math.round(metrics.loadPercent)}%</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--hvac">
              <p className="text-xs uppercase tracking-wide text-muted">Apparent power</p>
              <p className="text-2xl font-bold mt-1">{metrics.apparentPower.toFixed(1)} VA</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">Real power</p>
              <p className="text-2xl font-bold mt-1">{metrics.realPower.toFixed(1)} W</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
              <p className="text-xs uppercase tracking-wide text-muted">Power factor</p>
              <p className="text-2xl font-bold mt-1">{metrics.powerFactor.toFixed(2)}</p>
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
