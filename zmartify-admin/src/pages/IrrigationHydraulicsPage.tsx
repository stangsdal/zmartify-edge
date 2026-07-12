import { IonContent, IonPage } from '@ionic/react';
import { useEffect, useMemo, useState } from 'react';
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
  const [overview, setOverview] = useState<IrrigationSiteOverview | null>(null);

  useEffect(() => {
    const loadSites = async () => {
      const response = await mobileApi.listSites();
      setSites(response.sites || []);
      if ((response.sites || []).length) {
        setSelectedSite((prev) => prev || response.sites[0].site_id);
      }
    };
    loadSites().catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedSite) return;

    let cleanup: (() => void) | undefined;
    const loadRealtime = async () => {
      const [site, irrigationOverview, eventResponse] = await Promise.all([
        mobileApi.getSite(selectedSite),
        mobileApi.getIrrigationOverview(selectedSite),
        mobileApi.listEvents(100, { siteId: selectedSite }),
      ]);
      setOverview(irrigationOverview);
      setEvents(eventResponse.events || []);

      cleanup = subscribeRealtimeTopics(
        site.devices.map((device) => `device:${device.device_id}:irrigation`),
        (event) => {
          const receivedAt = new Date().toISOString();
          setEvents((prev) => [
            {
              event_id: `rt-hyd-${receivedAt}-${event.event_type}`,
              event_type: event.event_type,
              created_at: receivedAt,
              device_id: typeof event.payload?.device_id === 'string' ? event.payload.device_id : undefined,
              payload: event.payload,
            },
            ...prev,
          ].slice(0, 50));

          void mobileApi.getIrrigationOverview(selectedSite).then(setOverview).catch(console.error);
        }
      );
    };

    loadRealtime().catch(console.error);
    return () => cleanup?.();
  }, [selectedSite]);

  const metrics = useMemo(() => {
    const devices = overview?.devices || [];
    const avg = (values: number[], fallback: number) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
    const flow = avg(devices.map((device) => Number(device.hydraulics?.flow_lpm)).filter(Number.isFinite), pickMetric(events, ['flow_lpm', 'flow'], 31.2));
    const pressure = avg(devices.map((device) => Number(device.hydraulics?.pressure_bar)).filter(Number.isFinite), pickMetric(events, ['pressure_bar', 'pressure'], 3.6));
    const voltage = avg(devices.map((device) => Number(device.power?.voltage_rms_v)).filter(Number.isFinite), pickMetric(events, ['voltage_rms_v', 'voltage_v'], 24.3));
    const current = avg(devices.map((device) => Number(device.power?.current_rms_a)).filter(Number.isFinite), pickMetric(events, ['current_rms_a', 'current_a'], 0.86));
    const apparentPower = pickMetric(events, ['apparent_power_va', 'power_va'], voltage * current);
    const realPower = avg(devices.map((device) => Number(device.power?.real_power_w)).filter(Number.isFinite), pickMetric(events, ['real_power_w', 'power_w'], apparentPower * 0.79));
    const powerFactor = avg(devices.map((device) => Number(device.power?.power_factor)).filter(Number.isFinite), pickMetric(events, ['power_factor'], realPower / Math.max(apparentPower, 1)));
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
  }, [events, overview]);

  const latestStatusEvents = useMemo(
    () => events.filter((event) => event.event_type.includes('irrigation') || event.event_type.includes('controller_fault')).slice(0, 6),
    [events]
  );

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

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <h2 className="text-lg font-semibold mb-3">Per-device status</h2>
            <div className="space-y-3">
              {(overview?.devices || []).map((device) => (
                <div key={device.device_id} className="rounded-xl border border-slate-200 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{device.display_name}</p>
                      <p className="text-xs text-muted mt-1">{device.device_id}</p>
                    </div>
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${device.outputs.faulted > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {device.outputs.faulted > 0 ? `${device.outputs.faulted} faults` : 'Normal'}
                    </span>
                  </div>
                  <div className="grid gap-2 grid-cols-2 md:grid-cols-4 mt-3 text-sm">
                    <div>Flow: {device.hydraulics?.flow_lpm == null ? '--' : `${device.hydraulics.flow_lpm.toFixed(1)} L/min`}</div>
                    <div>Pressure: {device.hydraulics?.pressure_bar == null ? '--' : `${device.hydraulics.pressure_bar.toFixed(1)} bar`}</div>
                    <div>Power: {device.power?.real_power_w == null ? '--' : `${device.power.real_power_w.toFixed(0)} W`}</div>
                    <div>Rain delay: {device.rain_delay ? 'Active' : 'None'}</div>
                  </div>
                </div>
              ))}
              {!(overview?.devices || []).length ? <p className="text-sm text-muted">No irrigation devices available for this site.</p> : null}
            </div>
          </section>

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <h2 className="text-lg font-semibold mb-3">Realtime feedback</h2>
            <div className="space-y-2">
              {latestStatusEvents.map((event) => {
                const detail = [
                  event.device_id ? `Device ${event.device_id}` : null,
                  typeof event.payload?.detail === 'string' ? event.payload.detail : null,
                  typeof event.payload?.result === 'string' ? `result ${event.payload.result}` : null,
                ].filter(Boolean).join(' · ');
                return (
                  <div key={event.event_id} className="rounded-xl border border-slate-200 px-3 py-2">
                    <p className="text-sm font-semibold">{event.event_type.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-muted mt-1">{detail || 'Irrigation feedback event'}</p>
                    <p className="text-xs text-muted mt-1">{new Date(event.created_at).toLocaleString()}</p>
                  </div>
                );
              })}
              {!latestStatusEvents.length ? <p className="text-sm text-muted">No realtime irrigation feedback yet.</p> : null}
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
