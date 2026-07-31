import { useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { NavLink } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { IrrigationSiteOverview, IrrigationZone, mobileApi, MobileEvent, MobileSiteSummary } from '../api/mobile';
import { commandsApi } from '../api/commands';

interface DeviceZoneRow {
  deviceId: string;
  displayName: string;
  zone: IrrigationZone;
}

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
  const [overview, setOverview] = useState<IrrigationSiteOverview | null>(null);
  const [zones, setZones] = useState<DeviceZoneRow[]>([]);
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [busyAction, setBusyAction] = useState('');
  const [actionFeedback, setActionFeedback] = useState('');

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
      const [site, irrigationOverview] = await Promise.all([
        mobileApi.getSite(selectedSite),
        mobileApi.getIrrigationOverview(selectedSite),
      ]);
      setOverview(irrigationOverview);
      const detailRows = await Promise.all(
        site.devices.map(async (device) => {
          const response = await mobileApi.listIrrigationZones(device.device_id);
          return (response.zones || []).map((zone) => ({
            deviceId: device.device_id,
            displayName: device.display_name,
            zone,
          }));
        })
      );
      setZones(detailRows.flat());
    };
    loadSiteZones().catch(console.error);
  }, [selectedSite]);

  useEffect(() => {
    if (!selectedSite) return undefined;
    const intervalId = window.setInterval(() => {
      mobileApi.getIrrigationOverview(selectedSite).then(setOverview).catch(console.error);
    }, 8000);
    return () => window.clearInterval(intervalId);
  }, [selectedSite]);

  const activeDeviceIds = useMemo(() => new Set((overview?.devices || []).filter((device) => device.outputs.active > 0).map((device) => device.device_id)), [overview]);
  const activeZones = useMemo(() => zones.filter((row) => activeDeviceIds.has(row.deviceId)), [activeDeviceIds, zones]);
  const activeZone = activeZones[0] || null;
  const activeRuntime = useMemo(
    () => (overview?.devices || []).find((device) => device.runtime?.active_program_name || device.runtime?.active_zone_id != null) || null,
    [overview],
  );
  const controllerRunning = activeZone != null || activeRuntime != null;
  const commandDeviceId = useMemo(() => activeZone?.deviceId || overview?.devices[0]?.device_id || zones[0]?.deviceId || '', [activeZone, overview, zones]);

  const runDeviceAction = async (action: 'stop' | 'rain-delay') => {
    if (!commandDeviceId) {
      setActionFeedback('No irrigation controller is available for this site.');
      return;
    }
    setBusyAction(action);
    setActionFeedback('');
    try {
      const result = action === 'stop'
        ? await commandsApi.stopIrrigation(commandDeviceId)
        : await commandsApi.setIrrigationRainDelay(commandDeviceId, 24, 'app');
      const status = typeof result.status === 'string' ? result.status : 'submitted';
      const commandId = typeof result.command_id === 'string' ? result.command_id : 'n/a';
      setActionFeedback(`${action === 'stop' ? 'Stop all' : 'Rain delay'} command ${status}. Command id: ${commandId}`);
    } catch (error) {
      setActionFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction('');
    }
  };

  const flowLpm = useMemo(() => {
    for (const event of events) {
      const value = extractFromPayload(event.payload, ['flow_lpm', 'flow']);
      if (value != null) return value;
    }
    const value = overview?.devices.find((device) => device.hydraulics?.flow_lpm != null)?.hydraulics?.flow_lpm;
    return value == null ? null : value;
  }, [events, overview]);

  const pressureBar = useMemo(() => {
    for (const event of events) {
      const value = extractFromPayload(event.payload, ['pressure_bar', 'pressure']);
      if (value != null) return value;
    }
    const value = overview?.devices.find((device) => device.hydraulics?.pressure_bar != null)?.hydraulics?.pressure_bar;
    return value == null ? null : value;
  }, [events, overview]);

  const waterTodayLiters = useMemo(() => {
    for (const event of events) {
      const value = extractFromPayload(event.payload, ['water_liters', 'water_today_liters']);
      if (value != null) return Math.round(value);
    }
    const water = (overview?.devices || []).reduce((sum, device) => sum + (device.hydraulics?.water_liters || 0), 0);
    return Math.round(water);
  }, [events, overview]);

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
            <h1 className="text-3xl font-bold mt-1">{controllerRunning ? 'Running' : 'Idle'}</h1>
            <p className="mt-2 text-sm opacity-90">
              {activeZone
                ? `${activeZone.zone.name || 'Zone'} is active on ${activeZone.displayName}.`
                : activeRuntime
                  ? `${activeRuntime.runtime?.active_program_name || 'A program'} is active${activeRuntime.runtime?.active_zone_name ? ` on ${activeRuntime.runtime.active_zone_name}` : ''}.`
                  : 'No active irrigation run.'}
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
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-xl bg-white/95 px-4 py-2 text-sm font-semibold text-teal-800 disabled:opacity-60"
                disabled={!commandDeviceId || busyAction === 'stop'}
                onClick={() => { void runDeviceAction('stop'); }}
              >
                {busyAction === 'stop' ? 'Stopping...' : 'Stop all'}
              </button>
              <button
                type="button"
                className="rounded-xl border border-white/70 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={!commandDeviceId || busyAction === 'rain-delay'}
                onClick={() => { void runDeviceAction('rain-delay'); }}
              >
                {busyAction === 'rain-delay' ? 'Setting...' : 'Rain delay 24h'}
              </button>
            </div>
            {actionFeedback ? <p className="mt-3 text-sm opacity-90">{actionFeedback}</p> : null}
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
              <p className="text-xs uppercase tracking-wide text-muted">Water today</p>
              <p className="text-2xl font-bold mt-1">{waterTodayLiters.toLocaleString()} L</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">Active zones</p>
              <p className="text-2xl font-bold mt-1">{overview?.active_run_count || activeZones.length}</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--hvac">
              <p className="text-xs uppercase tracking-wide text-muted">Total zones</p>
              <p className="text-2xl font-bold mt-1">{overview?.zone_count || zones.length}</p>
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
            <NavLink className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100 no-underline text-current" to="/app/control/irrigation/setup">
              <p className="font-semibold">Setup</p>
              <p className="text-sm text-muted mt-1">Configure controller zones and valve outputs.</p>
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
              {zones.map((row) => {
                const zoneRef = row.zone.zone_id;
                const active = activeDeviceIds.has(row.deviceId);
                return (
                  <NavLink
                    key={zoneRef}
                    to={`/app/control/irrigation/zones/${encodeURIComponent(zoneRef)}?deviceId=${encodeURIComponent(row.deviceId)}`}
                    className="block rounded-xl border border-slate-200/70 p-3 no-underline text-current"
                  >
                    <p className="font-semibold">{row.zone.name || row.zone.local_ref}</p>
                    <p className="text-sm text-muted">{row.displayName} · {row.zone.enabled ? (active ? 'Running' : 'Ready') : 'Disabled'}</p>
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
