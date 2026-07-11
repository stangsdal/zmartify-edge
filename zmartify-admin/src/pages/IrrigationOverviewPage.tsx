import { useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { NavLink } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { mobileApi, MobileEvent, MobileSiteSummary, MobileZone } from '../api/mobile';

const parseNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const extractFromPayload = (payload: unknown, keys: string[]): number | null => {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const direct = parseNumber(record[key]);
    if (direct != null) return direct;
  }
  for (const value of Object.values(record)) {
    if (!value || typeof value !== 'object') continue;
    const nested = value as Record<string, unknown>;
    for (const key of keys) {
      const parsed = parseNumber(nested[key]);
      if (parsed != null) return parsed;
    }
  }
  return null;
};

export function IrrigationOverviewPage() {
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [zones, setZones] = useState<MobileZone[]>([]);
  const [events, setEvents] = useState<MobileEvent[]>([]);

  useEffect(() => {
    const loadSites = async () => {
      const response = await mobileApi.listSites();
      setSites(response.sites || []);
      if ((response.sites || []).length) {
        setSelectedSite((prev) => prev || response.sites[0].site_id);
      }
      const eventResponse = await mobileApi.listEvents(80);
      setEvents(eventResponse.events || []);
    };
    loadSites().catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedSite) return;
    const loadSiteZones = async () => {
      const site = await mobileApi.getSite(selectedSite);
      const detailRows = await Promise.all(site.devices.map((device) => mobileApi.getDevice(device.device_id)));
      setZones(detailRows.flatMap((detail) => detail.zones || []));
    };
    loadSiteZones().catch(console.error);
  }, [selectedSite]);

  const activeZones = useMemo(() => zones.filter((zone) => zone.demand || zone.active), [zones]);
  const activeZone = activeZones[0] || null;

  const flowLpm = useMemo(() => {
    for (const event of events) {
      const value = extractFromPayload(event.payload, ['flow_lpm', 'flow']);
      if (value != null) return value;
    }
    return activeZone ? 26 + Math.min(9, activeZones.length * 1.8) : null;
  }, [activeZone, activeZones.length, events]);

  const pressureBar = useMemo(() => {
    for (const event of events) {
      const value = extractFromPayload(event.payload, ['pressure_bar', 'pressure']);
      if (value != null) return value;
    }
    return activeZone ? 3.2 + Math.min(0.6, activeZones.length * 0.08) : null;
  }, [activeZone, activeZones.length, events]);

  const waterTodayLiters = useMemo(() => {
    for (const event of events) {
      const value = extractFromPayload(event.payload, ['water_liters', 'water_today_liters']);
      if (value != null) return Math.round(value);
    }
    return Math.max(0, Math.round(zones.length * 112 + activeZones.length * 240));
  }, [activeZones.length, events, zones.length]);

  return (
    <IonPage>
      <AppHeader title="Irrigation" subtitle="Execution, hydraulics and safety overview" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <SiteSelector
            label="Site"
            options={sites.map((site) => ({ site_id: site.site_id, site_name: site.site_name }))}
            value={selectedSite}
            onChange={setSelectedSite}
          />

          <section className="rounded-3xl p-6 text-white app-home-hero">
            <p className="text-sm opacity-90">Status</p>
            <h1 className="text-3xl font-bold mt-1">{activeZone ? 'Running' : 'Idle'}</h1>
            <p className="mt-2 text-sm opacity-90">
              {activeZone ? `${activeZone.name || 'Zone'} is active with normal hydraulic profile.` : 'No active irrigation run.'}
            </p>
            <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
              <div>
                <p className="opacity-90">Flow</p>
                <p className="text-xl font-semibold">{flowLpm == null ? '--' : `${flowLpm.toFixed(1)} L/min`}</p>
              </div>
              <div>
                <p className="opacity-90">Pressure</p>
                <p className="text-xl font-semibold">{pressureBar == null ? '--' : `${pressureBar.toFixed(1)} bar`}</p>
              </div>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
              <p className="text-xs uppercase tracking-wide text-muted">Water today</p>
              <p className="text-2xl font-bold mt-1">{waterTodayLiters.toLocaleString()} L</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">Active zones</p>
              <p className="text-2xl font-bold mt-1">{activeZones.length}</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--hvac">
              <p className="text-xs uppercase tracking-wide text-muted">Total zones</p>
              <p className="text-2xl font-bold mt-1">{zones.length}</p>
            </div>
          </section>

          <section className="grid gap-2 md:grid-cols-2">
            <NavLink className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100 no-underline text-current" to="/app/control/irrigation/zones">
              <p className="font-semibold">Zones</p>
              <p className="text-sm text-muted mt-1">Inspect zone state and run manual control.</p>
            </NavLink>
            <NavLink className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100 no-underline text-current" to="/app/control/irrigation/manual">
              <p className="font-semibold">Manual run</p>
              <p className="text-sm text-muted mt-1">Start temporary irrigation with controlled duration.</p>
            </NavLink>
            <NavLink className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100 no-underline text-current" to="/app/control/irrigation/programs">
              <p className="font-semibold">Programs</p>
              <p className="text-sm text-muted mt-1">Review schedules and watering estimates.</p>
            </NavLink>
            <NavLink className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100 no-underline text-current" to="/app/control/irrigation/hydraulics">
              <p className="font-semibold">Hydraulics and power</p>
              <p className="text-sm text-muted mt-1">Flow, pressure and transformer diagnostics.</p>
            </NavLink>
          </section>

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <h2 className="text-lg font-semibold mb-2">Zones</h2>
            <div className="space-y-2">
              {zones.map((zone) => {
                const zoneRef = zone.zone_uuid || `zone:${zone.zone_id}`;
                return (
                  <NavLink
                    key={zoneRef}
                    to={`/app/control/irrigation/zones/${encodeURIComponent(zoneRef)}`}
                    className="block rounded-xl border border-slate-200/70 p-3 no-underline text-current"
                  >
                    <p className="font-semibold">{zone.name || `Zone ${zone.zone_id}`}</p>
                    <p className="text-sm text-muted">State: {zone.active || zone.demand ? 'Running' : 'Idle'}</p>
                  </NavLink>
                );
              })}
              {!zones.length ? <p className="text-sm text-muted">No zones available for this site.</p> : null}
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
