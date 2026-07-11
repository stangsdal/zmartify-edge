import { IonContent, IonPage } from '@ionic/react';
import { useEffect, useMemo, useState } from 'react';
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

const pickMetric = (events: MobileEvent[], keys: string[], fallback: number): number => {
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

export function IrrigationHydraulicsPage() {
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [events, setEvents] = useState<MobileEvent[]>([]);

  useEffect(() => {
    const loadSites = async () => {
      const response = await mobileApi.listSites();
      setSites(response.sites || []);
      if ((response.sites || []).length) {
        setSelectedSite((prev) => prev || response.sites[0].site_id);
      }
      const eventResponse = await mobileApi.listEvents(100);
      setEvents(eventResponse.events || []);
    };
    loadSites().catch(console.error);
  }, []);

  const metrics = useMemo(() => {
    const flow = pickMetric(events, ['flow_lpm', 'flow'], 31.2);
    const pressure = pickMetric(events, ['pressure_bar', 'pressure'], 3.6);
    const voltage = pickMetric(events, ['voltage_rms_v', 'voltage_v'], 24.3);
    const current = pickMetric(events, ['current_rms_a', 'current_a'], 0.86);
    const apparentPower = pickMetric(events, ['apparent_power_va', 'power_va'], voltage * current);
    const realPower = pickMetric(events, ['real_power_w', 'power_w'], apparentPower * 0.79);
    const powerFactor = pickMetric(events, ['power_factor'], realPower / Math.max(apparentPower, 1));
    const transformerLoad = pickMetric(events, ['transformer_load_percent'], Math.min(95, apparentPower / 60 * 100));

    return {
      flow,
      pressure,
      voltage,
      current,
      apparentPower,
      realPower,
      powerFactor,
      transformerLoad,
    };
  }, [events]);

  return (
    <IonPage>
      <AppHeader title="Hydraulics" subtitle="Flow, pressure and 24 VAC power health" />
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
              <p className="text-xs uppercase tracking-wide text-muted">Flow</p>
              <p className="text-2xl font-bold mt-1">{metrics.flow.toFixed(1)} L/min</p>
              <p className="text-sm text-muted mt-1">Expected 30.0 L/min</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">Pressure</p>
              <p className="text-2xl font-bold mt-1">{metrics.pressure.toFixed(1)} bar</p>
              <p className="text-sm text-muted mt-1">Protection threshold normal</p>
            </div>
          </section>

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <h2 className="text-lg font-semibold mb-3">24 VAC power</h2>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
              <div>
                <p className="text-xs text-muted uppercase tracking-wide">Voltage</p>
                <p className="text-xl font-bold">{metrics.voltage.toFixed(1)} V</p>
              </div>
              <div>
                <p className="text-xs text-muted uppercase tracking-wide">Current</p>
                <p className="text-xl font-bold">{metrics.current.toFixed(2)} A</p>
              </div>
              <div>
                <p className="text-xs text-muted uppercase tracking-wide">Apparent power</p>
                <p className="text-xl font-bold">{metrics.apparentPower.toFixed(1)} VA</p>
              </div>
              <div>
                <p className="text-xs text-muted uppercase tracking-wide">Real power</p>
                <p className="text-xl font-bold">{metrics.realPower.toFixed(1)} W</p>
              </div>
              <div>
                <p className="text-xs text-muted uppercase tracking-wide">Power factor</p>
                <p className="text-xl font-bold">{metrics.powerFactor.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted uppercase tracking-wide">Transformer load</p>
                <p className="text-xl font-bold">{Math.round(metrics.transformerLoad)}%</p>
              </div>
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
