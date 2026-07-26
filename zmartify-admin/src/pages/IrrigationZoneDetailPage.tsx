import { useEffect, useMemo, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { useLocation, useParams } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { IrrigationDeviceOverview, IrrigationZone, mobileApi, MobileEvent, subscribeRealtimeTopics } from '../api/mobile';
import { commandsApi } from '../api/commands';

interface RouteParams {
  zoneRef: string;
}

export function IrrigationZoneDetailPage() {
  const { zoneRef } = useParams<RouteParams>();
  const location = useLocation();
  const resolvedRef = decodeURIComponent(zoneRef);
  const [zone, setZone] = useState<IrrigationZone | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [deviceOverview, setDeviceOverview] = useState<IrrigationDeviceOverview | null>(null);
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [durationMinutes, setDurationMinutes] = useState(10);
  const [busyAction, setBusyAction] = useState('');
  const [commandFeedback, setCommandFeedback] = useState('');

  const locationDeviceId = useMemo(() => new URLSearchParams(location.search).get('deviceId') || '', [location.search]);

  useEffect(() => {
    const load = async () => {
      const sites = await mobileApi.listSites();
      for (const site of sites.sites || []) {
        const siteDetail = await mobileApi.getSite(site.site_id);
        for (const device of siteDetail.devices) {
          if (locationDeviceId && device.device_id !== locationDeviceId) continue;
          const detail = await mobileApi.listIrrigationZones(device.device_id);
          for (const candidate of detail.zones || []) {
            const candidateRef = candidate.zone_id;
            if (candidateRef === resolvedRef) {
              setZone(candidate);
              setDeviceId(device.device_id);
              setSiteId(site.site_id);
              const irrigationOverview = await mobileApi.getIrrigationOverview(site.site_id);
              setDeviceOverview((irrigationOverview.devices || []).find((row) => row.device_id === device.device_id) || null);

              const eventResponse = await mobileApi.listEvents(80, { siteId: site.site_id });
              const filtered = (eventResponse.events || []).filter((event) => {
                const eventDeviceId = event.device_id || (typeof event.payload?.device_id === 'string' ? event.payload.device_id : '');
                const eventZoneRef = typeof event.payload?.target_ref === 'string' ? event.payload.target_ref : null;
                return eventDeviceId === device.device_id && (eventZoneRef == null || eventZoneRef === candidate.local_ref || eventZoneRef === candidate.zone_id);
              });
              setEvents(filtered.slice(0, 20));
              return;
            }
          }
        }
      }

      if (locationDeviceId) {
        for (const site of sites.sites || []) {
          const irrigationOverview = await mobileApi.getIrrigationOverview(site.site_id);
          const matchedDevice = (irrigationOverview.devices || []).find((row) => row.device_id === locationDeviceId);
          if (!matchedDevice) continue;
          setSiteId(site.site_id);
          setDeviceId(locationDeviceId);
          setDeviceOverview(matchedDevice);
          const eventResponse = await mobileApi.listEvents(80, { siteId: site.site_id });
          setEvents(
            (eventResponse.events || [])
              .filter((event) => (event.device_id || event.payload?.device_id) === locationDeviceId)
              .slice(0, 20)
          );
          return;
        }
      }
      setZone(null);
    };
    load().catch(console.error);
  }, [locationDeviceId, resolvedRef]);

  useEffect(() => {
    if (!deviceId) return;

    const unsubscribe = subscribeRealtimeTopics([`device:${deviceId}:irrigation`], (event) => {
      const receivedAt = new Date().toISOString();
      setEvents((prev) => [
        {
          event_id: `rt-zone-detail-${receivedAt}-${event.event_type}`,
          event_type: event.event_type,
          created_at: receivedAt,
          device_id: typeof event.payload?.device_id === 'string' ? event.payload.device_id : deviceId,
          payload: event.payload,
        },
        ...prev,
      ].slice(0, 20));

      if (siteId) {
        void mobileApi.getIrrigationOverview(siteId).then((overview) => {
          setDeviceOverview((overview.devices || []).find((row) => row.device_id === deviceId) || null);
        }).catch(console.error);
      }
    });

    return unsubscribe;
  }, [deviceId, siteId]);

  const stateLabel = useMemo(() => {
    if (!zone) return 'Unknown';
    if (!zone.enabled) return 'Disabled';
    if ((deviceOverview?.outputs?.active || 0) > 0) return 'Running';
    return 'Ready';
  }, [deviceOverview, zone]);

  const eventRows = useMemo(() => events.slice(0, 8), [events]);

  const runZoneCommand = async (action: 'start' | 'stop') => {
    if (!zone || !deviceId) {
      setCommandFeedback('Zone command is unavailable until the controller and zone are loaded.');
      return;
    }
    const targetRef = zone.local_ref || zone.zone_id;
    setBusyAction(action);
    setCommandFeedback('');
    try {
      const result = action === 'start'
        ? await commandsApi.startIrrigationZone(deviceId, targetRef, durationMinutes * 60)
        : await commandsApi.stopIrrigationZone(deviceId, targetRef);
      const status = typeof result.status === 'string' ? result.status : 'submitted';
      const commandId = typeof result.command_id === 'string' ? result.command_id : 'n/a';
      setCommandFeedback(`${action === 'start' ? 'Start' : 'Stop'} command ${status}. Command id: ${commandId}`);
    } catch (error) {
      setCommandFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction('');
    }
  };

  return (
    <IonPage>
      <AppHeader title={zone?.name || deviceOverview?.display_name || 'Irrigation zone'} subtitle="Zone profile, alarms and realtime device context" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Status</p>
            <p className="text-xl font-bold mt-1">{stateLabel}</p>
            <p className="text-sm text-muted mt-2">Local ref: {zone?.local_ref || resolvedRef}</p>
            {deviceId ? <p className="text-sm text-muted mt-1">Device: {deviceId}</p> : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <select
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(Number(event.target.value))}
              >
                {[5, 10, 15, 20, 30, 45].map((value) => <option key={value} value={value}>{value} min</option>)}
              </select>
              <button
                type="button"
                className="rounded-xl bg-teal-700 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
                disabled={!zone || !deviceId || busyAction === 'start'}
                onClick={() => { void runZoneCommand('start'); }}
              >
                {busyAction === 'start' ? 'Starting...' : 'Start zone'}
              </button>
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-60"
                disabled={!zone || !deviceId || busyAction === 'stop'}
                onClick={() => { void runZoneCommand('stop'); }}
              >
                {busyAction === 'stop' ? 'Stopping...' : 'Stop zone'}
              </button>
            </div>
            {commandFeedback ? <p className="text-sm text-muted mt-2">{commandFeedback}</p> : null}
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
              <p className="text-xs uppercase tracking-wide text-muted">Current reading</p>
              <p className="text-2xl font-bold mt-1">{deviceOverview?.hydraulics?.water_liters == null ? '--' : `${Math.round(deviceOverview.hydraulics.water_liters).toLocaleString()} L`}</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">Output ref</p>
              <p className="text-2xl font-bold mt-1">{zone?.local_ref || '--'}</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--hvac">
              <p className="text-xs uppercase tracking-wide text-muted">Enabled</p>
              <p className="text-2xl font-bold mt-1">{zone?.enabled ? 'Yes' : 'No'}</p>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-2">
            <div className={`rounded-2xl app-surface p-4 shadow-soft border ${deviceOverview?.outputs?.faulted ? 'border-rose-300 bg-rose-50/60' : 'border-slate-100'}`}>
              <p className="text-xs uppercase tracking-wide text-muted">Output health</p>
              <p className="text-xl font-bold mt-1">{deviceOverview?.outputs?.faulted || 0} faulted</p>
              <p className="text-sm text-muted mt-1">Active outputs: {deviceOverview?.outputs?.active || 0} / {deviceOverview?.outputs?.total || 0}</p>
            </div>
            <div className={`rounded-2xl app-surface p-4 shadow-soft border ${deviceOverview?.rain_delay ? 'border-amber-300 bg-amber-50/60' : 'border-slate-100'}`}>
              <p className="text-xs uppercase tracking-wide text-muted">Rain delay</p>
              <p className="text-xl font-bold mt-1">{deviceOverview?.rain_delay ? 'Active' : 'Inactive'}</p>
              <p className="text-sm text-muted mt-1">
                {deviceOverview?.rain_delay?.active_until ? new Date(deviceOverview.rain_delay.active_until).toLocaleString() : 'No active hold'}
              </p>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--weather">
              <p className="text-xs uppercase tracking-wide text-muted">Flow</p>
              <p className="text-2xl font-bold mt-1">{deviceOverview?.hydraulics?.flow_lpm == null ? '--' : `${deviceOverview.hydraulics.flow_lpm.toFixed(1)} L/min`}</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--irrigation">
              <p className="text-xs uppercase tracking-wide text-muted">Pressure</p>
              <p className="text-2xl font-bold mt-1">{deviceOverview?.hydraulics?.pressure_bar == null ? '--' : `${deviceOverview.hydraulics.pressure_bar.toFixed(1)} bar`}</p>
            </div>
            <div className="rounded-2xl app-surface p-4 shadow-soft app-system-card app-system-card--hvac">
              <p className="text-xs uppercase tracking-wide text-muted">Power</p>
              <p className="text-2xl font-bold mt-1">{deviceOverview?.power?.real_power_w == null ? '--' : `${deviceOverview.power.real_power_w.toFixed(0)} W`}</p>
            </div>
          </section>

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Alarm and feedback history</p>
            <div className="space-y-2 mt-2">
              {eventRows.map((event) => {
                const payload = event.payload || {};
                const detailParts = [
                  typeof payload.event_type === 'string' ? payload.event_type : null,
                  typeof payload.detail === 'string' ? payload.detail : null,
                  typeof payload.result === 'string' ? `result ${payload.result}` : null,
                  typeof payload.command_id === 'string' ? `cmd ${payload.command_id}` : null,
                ].filter(Boolean);
                return (
                  <div key={event.event_id} className="rounded-xl border border-slate-200 px-3 py-2">
                    <p className="text-sm font-semibold">{event.event_type.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-muted mt-1">{detailParts.join(' · ') || 'Irrigation event'}</p>
                    <p className="text-xs text-muted mt-1">{new Date(event.created_at).toLocaleString()}</p>
                  </div>
                );
              })}
              {!eventRows.length ? <p className="text-sm text-muted">No irrigation history available yet.</p> : null}
            </div>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
