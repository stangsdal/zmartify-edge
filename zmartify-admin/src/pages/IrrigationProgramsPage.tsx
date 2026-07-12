import { IonButton, IonContent, IonPage } from '@ionic/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import { mobileApi, MobileEvent, MobileSiteSummary, IrrigationProgramSummary, IrrigationScheduleSummary, subscribeRealtimeTopics } from '../api/mobile';

type DeviceProgram = {
  deviceId: string;
  displayName: string;
  program: IrrigationProgramSummary;
  schedules: IrrigationScheduleSummary[];
};

const weekdayLabel = (weekday: number): string => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday] || String(weekday);

export function IrrigationProgramsPage() {
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [programRows, setProgramRows] = useState<DeviceProgram[]>([]);
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const [actionFeedback, setActionFeedback] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [newProgramName, setNewProgramName] = useState('');

  const reloadPrograms = useCallback(async (siteId: string) => {
    const site = await mobileApi.getSite(siteId);
    setDeviceIds(site.devices.map((device) => device.device_id));
    const nextRows = await Promise.all(
      site.devices.map(async (device) => {
        const programsResponse = await mobileApi.listIrrigationPrograms(device.device_id);
        return Promise.all(
          (programsResponse.programs || []).map(async (program) => {
            const schedulesResponse = await mobileApi.listIrrigationProgramSchedules(device.device_id, program.program_id);
            return {
              deviceId: device.device_id,
              displayName: device.display_name,
              program,
              schedules: schedulesResponse.schedules || [],
            } satisfies DeviceProgram;
          })
        );
      })
    );
    setProgramRows(nextRows.flat());
  }, []);

  const runProgramNow = async (row: DeviceProgram) => {
    const key = `run:${row.deviceId}:${row.program.program_id}`;
    setBusyKey(key);
    setActionFeedback('');
    try {
      const result = await mobileApi.startIrrigationProgramRun(row.deviceId, row.program.program_id);
      const runId = typeof (result.run as Record<string, unknown>)?.run_id === 'string' ? String((result.run as Record<string, unknown>).run_id) : 'n/a';
      setActionFeedback(`Run started for ${row.program.name} (run ${runId}).`);
    } catch (error) {
      setActionFeedback(String(error));
    } finally {
      setBusyKey('');
    }
  };

  const toggleProgramEnabled = async (row: DeviceProgram) => {
    const key = `toggle:${row.deviceId}:${row.program.program_id}`;
    setBusyKey(key);
    setActionFeedback('');
    try {
      await mobileApi.updateIrrigationProgram(row.deviceId, row.program.program_id, {
        name: row.program.name,
        enabled: !row.program.enabled,
        seasonal_adjustment: row.program.seasonal_adjustment,
        weather_mode: row.program.weather_mode,
      });
      await reloadPrograms(selectedSite);
      setActionFeedback(`${row.program.name} is now ${row.program.enabled ? 'paused' : 'enabled'}.`);
    } catch (error) {
      setActionFeedback(String(error));
    } finally {
      setBusyKey('');
    }
  };

  const addDefaultSchedule = async (row: DeviceProgram) => {
    const key = `schedule:${row.deviceId}:${row.program.program_id}`;
    setBusyKey(key);
    setActionFeedback('');
    try {
      await mobileApi.createIrrigationProgramSchedule(row.deviceId, row.program.program_id, {
        name: 'Morning window',
        start_local_time: '06:00',
        weekdays: [1, 2, 3, 4, 5],
        enabled: true,
      });
      await reloadPrograms(selectedSite);
      setActionFeedback(`Schedule added to ${row.program.name}.`);
    } catch (error) {
      setActionFeedback(String(error));
    } finally {
      setBusyKey('');
    }
  };

  const createProgram = async () => {
    const name = newProgramName.trim();
    if (!name || !deviceIds.length) {
      setActionFeedback('Provide a program name and ensure a device exists on the site.');
      return;
    }
    setBusyKey('create');
    setActionFeedback('');
    try {
      await mobileApi.createIrrigationProgram(deviceIds[0], { name, enabled: true });
      setNewProgramName('');
      await reloadPrograms(selectedSite);
      setActionFeedback(`Program "${name}" created.`);
    } catch (error) {
      setActionFeedback(String(error));
    } finally {
      setBusyKey('');
    }
  };

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

    const loadPrograms = async () => {
      await reloadPrograms(selectedSite);
      const site = await mobileApi.getSite(selectedSite);

      cleanup = subscribeRealtimeTopics(
        site.devices.map((device) => `device:${device.device_id}:irrigation`),
        (event) => {
          const receivedAt = new Date().toISOString();
          setEvents((prev) => [
            {
              event_id: `rt-program-${receivedAt}-${event.event_type}`,
              event_type: event.event_type,
              created_at: receivedAt,
              device_id: typeof event.payload?.device_id === 'string' ? event.payload.device_id : undefined,
              payload: event.payload,
            },
            ...prev,
          ].slice(0, 30));
        }
      );
    };

    loadPrograms().catch(console.error);
    return () => cleanup?.();
  }, [reloadPrograms, selectedSite]);

  const latestRunEvent = useMemo(() => events.find((event) => event.event_type === 'irrigation.run.updated') || null, [events]);

  return (
    <IonPage>
      <AppHeader title="Programs" subtitle="Schedule design and runtime planning" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <SiteSelector
            label="Site"
            options={sites.map((site) => ({ site_id: site.site_id, site_name: site.site_name }))}
            value={selectedSite}
            onChange={setSelectedSite}
          />

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <p className="text-sm text-muted">Create program</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <input
                className="flex-1 min-w-48 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                placeholder="Program name"
                value={newProgramName}
                onChange={(event) => setNewProgramName(event.target.value)}
              />
              <IonButton size="small" disabled={busyKey === 'create'} onClick={() => { void createProgram(); }}>
                {busyKey === 'create' ? 'Creating...' : 'Create'}
              </IonButton>
            </div>
            {actionFeedback ? <p className="text-sm text-muted mt-2">{actionFeedback}</p> : null}
          </section>

          {programRows.map((row) => {
            const scheduleSummary = row.schedules.length
              ? row.schedules.map((schedule) => `${schedule.start_local_time} • ${schedule.weekdays.map(weekdayLabel).join(' ')}`).join(' | ')
              : 'No schedules defined';
            const latestForDevice = events.find((event) => event.device_id === row.deviceId);
            const estimateLiters = Math.max(60, Math.round(row.program.seasonal_adjustment * Math.max(1, row.schedules.length) * 120));
            return (
            <section key={`${row.deviceId}:${row.program.program_id}`} className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{row.program.name}</h2>
                  <p className="text-sm text-muted">{row.displayName} • {scheduleSummary}</p>
                </div>
                <span
                  className="inline-flex rounded-full px-3 py-1 text-xs font-semibold"
                  style={{
                    color: row.program.enabled ? '#067647' : '#b54708',
                    backgroundColor: row.program.enabled ? 'rgba(18,183,106,0.15)' : 'rgba(247,144,9,0.16)',
                  }}
                >
                  {row.program.enabled ? 'Enabled' : 'Paused'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="rounded-xl p-3 app-system-card app-system-card--weather">
                  <p className="text-xs uppercase tracking-wide text-muted">Seasonal adjust</p>
                  <p className="text-xl font-bold mt-1">{Math.round(row.program.seasonal_adjustment * 100)}%</p>
                </div>
                <div className="rounded-xl p-3 app-system-card app-system-card--irrigation">
                  <p className="text-xs uppercase tracking-wide text-muted">Estimated water</p>
                  <p className="text-xl font-bold mt-1">{estimateLiters.toLocaleString()} L</p>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted">Weather mode</p>
                <p className="text-sm font-semibold mt-1">{row.program.weather_mode}</p>
                <p className="text-xs text-muted mt-2">
                  {latestForDevice
                    ? `Latest device event: ${latestForDevice.event_type.replace(/_/g, ' ')}`
                    : latestRunEvent
                      ? `Latest site run event: ${latestRunEvent.event_type.replace(/_/g, ' ')}`
                      : 'No realtime feedback yet'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                <IonButton
                  size="small"
                  disabled={busyKey === `run:${row.deviceId}:${row.program.program_id}`}
                  onClick={() => { void runProgramNow(row); }}
                >
                  Run now
                </IonButton>
                <IonButton
                  size="small"
                  fill="outline"
                  disabled={busyKey === `toggle:${row.deviceId}:${row.program.program_id}`}
                  onClick={() => { void toggleProgramEnabled(row); }}
                >
                  {row.program.enabled ? 'Pause' : 'Enable'}
                </IonButton>
                <IonButton
                  size="small"
                  fill="outline"
                  disabled={busyKey === `schedule:${row.deviceId}:${row.program.program_id}`}
                  onClick={() => { void addDefaultSchedule(row); }}
                >
                  Add schedule
                </IonButton>
              </div>
            </section>
          )})}

          {!programRows.length ? (
            <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
              <p className="text-sm text-muted">No irrigation programs are available for this site yet.</p>
            </section>
          ) : null}
        </div>
      </IonContent>
    </IonPage>
  );
}
