import { IonButton, IonContent, IonPage, IonToggle } from '@ionic/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import {
  mobileApi,
  MobileEvent,
  MobileSiteSummary,
  IrrigationProgramSummary,
  IrrigationProgramZoneSummary,
  IrrigationRunSummary,
  IrrigationScheduleSummary,
  IrrigationZone,
  subscribeRealtimeTopics,
} from '../api/mobile';

type DeviceProgram = {
  deviceId: string;
  displayName: string;
  program: IrrigationProgramSummary;
  availableZones: IrrigationZone[];
  programZones: IrrigationProgramZoneSummary[];
  schedules: IrrigationScheduleSummary[];
};

type ProgramZoneDraft = Record<string, { enabled: boolean; durationSeconds: number }>;

type ScheduleDraft = {
  name: string;
  startLocalTime: string;
  recurrenceType: string;
  weekdays: number[];
  intervalDays: number;
  anchorDate: string;
  datesText: string;
};

const weekdayLabel = (weekday: number): string => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday] || String(weekday);
const weekdayOptions = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const defaultScheduleDraft = (): ScheduleDraft => ({
  name: 'Morning schedule',
  startLocalTime: '06:00',
  recurrenceType: 'weekdays',
  weekdays: [1, 2, 3, 4, 5],
  intervalDays: 4,
  anchorDate: new Date().toISOString().slice(0, 10),
  datesText: '',
});

const scheduleToDraft = (schedule: IrrigationScheduleSummary): ScheduleDraft => ({
  name: schedule.name,
  startLocalTime: schedule.start_local_time,
  recurrenceType: schedule.recurrence_type || 'weekdays',
  weekdays: schedule.weekdays || [],
  intervalDays: schedule.interval_days || 4,
  anchorDate: schedule.anchor_date || new Date().toISOString().slice(0, 10),
  datesText: (schedule.dates || []).join(', '),
});

const schedulePayloadFromDraft = (draft: ScheduleDraft, enabled = true) => {
  const dates = draft.datesText
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    name: draft.name.trim() || 'Schedule',
    start_local_time: draft.startLocalTime,
    weekdays: draft.recurrenceType === 'weekdays' ? draft.weekdays : [],
    recurrence_type: draft.recurrenceType,
    interval_days: draft.recurrenceType === 'cyclic' ? Math.max(1, Number(draft.intervalDays || 1)) : null,
    anchor_date: draft.recurrenceType === 'cyclic' ? draft.anchorDate : null,
    dates: draft.recurrenceType === 'custom_dates' ? dates : [],
    enabled,
  };
};

const programKey = (row: DeviceProgram) => `${row.deviceId}:${row.program.program_id}`;

const scheduleSummaryLabel = (schedule: IrrigationScheduleSummary): string => {
  const recurrenceType = schedule.recurrence_type || 'weekdays';
  if (recurrenceType === 'odd_days') return `${schedule.start_local_time} • Odd days`;
  if (recurrenceType === 'even_days') return `${schedule.start_local_time} • Even days`;
  if (recurrenceType === 'cyclic') return `${schedule.start_local_time} • Every ${schedule.interval_days || 1} days from ${schedule.anchor_date || 'today'}`;
  if (recurrenceType === 'custom_dates') return `${schedule.start_local_time} • ${(schedule.dates || []).join(', ') || 'Selected dates'}`;
  return `${schedule.start_local_time} • ${schedule.weekdays.map(weekdayLabel).join(' ')}`;
};

const isIrrigationController = (device: { device_id: string; display_name: string; device_type?: string; integration_mode?: string }): boolean => {
  const haystack = [device.device_id, device.display_name, device.device_type, device.integration_mode]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes('irrigation');
};

export function IrrigationProgramsPage() {
  const [sites, setSites] = useState<MobileSiteSummary[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [programRows, setProgramRows] = useState<DeviceProgram[]>([]);
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const [actionFeedback, setActionFeedback] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [newProgramName, setNewProgramName] = useState('');
  const [programZoneDrafts, setProgramZoneDrafts] = useState<Record<string, ProgramZoneDraft>>({});
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, ScheduleDraft>>({});
  const [scheduleEditDrafts, setScheduleEditDrafts] = useState<Record<string, ScheduleDraft>>({});
  const [activeRuns, setActiveRuns] = useState<Record<string, IrrigationRunSummary>>({});

  const reloadPrograms = useCallback(async (siteId: string) => {
    const overview = await mobileApi.getIrrigationOverview(siteId).catch(() => null);
    const overviewDevices = (overview?.devices || []).map((device) => ({
      device_id: device.device_id,
      display_name: device.display_name,
    })).filter(isIrrigationController);
    let irrigationDevices = overviewDevices;
    if (!irrigationDevices.length) {
      const site = await mobileApi.getSite(siteId);
      irrigationDevices = site.devices.filter(isIrrigationController).map((device) => ({
        device_id: device.device_id,
        display_name: device.display_name,
      }));
    }
    setDeviceIds(irrigationDevices.map((device) => device.device_id));
    const deviceProgramGroups = await Promise.all(
      irrigationDevices.map(async (device) => {
        const [programsResponse, zonesResponse, runsResponse] = await Promise.all([
          mobileApi.listIrrigationPrograms(device.device_id),
          mobileApi.listIrrigationZones(device.device_id),
          mobileApi.listIrrigationRuns(device.device_id, 20),
        ]);
        const availableZones = zonesResponse.zones || [];
        const rows = await Promise.all(
          (programsResponse.programs || []).map(async (program) => {
            const [schedulesResponse, programZonesResponse] = await Promise.all([
              mobileApi.listIrrigationProgramSchedules(device.device_id, program.program_id),
              mobileApi.listIrrigationProgramZones(device.device_id, program.program_id),
            ]);
            return {
              deviceId: device.device_id,
              displayName: device.display_name,
              program,
              availableZones,
              programZones: programZonesResponse.zones || [],
              schedules: schedulesResponse.schedules || [],
            } satisfies DeviceProgram;
          })
        );
        return {
          deviceId: device.device_id,
          activeRun: (runsResponse.runs || []).find((run) => run.status === 'running'),
          rows,
        };
      })
    );
    setProgramRows(deviceProgramGroups.flatMap((group) => group.rows));
    setActiveRuns(Object.fromEntries(deviceProgramGroups.filter((group) => group.activeRun).map((group) => [group.deviceId, group.activeRun as IrrigationRunSummary])));
  }, []);

  const runProgramNow = async (row: DeviceProgram) => {
    const key = `run:${row.deviceId}:${row.program.program_id}`;
    setBusyKey(key);
    setActionFeedback('');
    try {
      const result = await mobileApi.startIrrigationProgramRun(row.deviceId, row.program.program_id);
      setActiveRuns((prev) => ({ ...prev, [row.deviceId]: result.run }));
      const currentStep = result.run.steps.find((step) => step.status === 'running');
      setActionFeedback(`Run started for ${row.program.name}${currentStep ? ` on ${currentStep.zone_name || currentStep.local_ref}` : ''}.`);
      setBusyKey('');
      reloadPrograms(selectedSite).catch(console.error);
    } catch (error) {
      setActionFeedback(String(error));
      setBusyKey('');
    }
  };

  const stopProgramRun = async (row: DeviceProgram, run: IrrigationRunSummary) => {
    const key = `stop:${row.deviceId}:${run.run_id}`;
    setBusyKey(key);
    setActionFeedback('Stopping program...');
    try {
      await mobileApi.stopIrrigationProgramRun(row.deviceId, run.run_id);
      setActiveRuns((prev) => {
        const next = { ...prev };
        delete next[row.deviceId];
        return next;
      });
      setActionFeedback(`Stopped ${row.program.name}.`);
      setBusyKey('');
      reloadPrograms(selectedSite).catch(console.error);
    } catch (error) {
      setActionFeedback(String(error));
      setBusyKey('');
    }
  };

  const skipProgramRunStep = async (row: DeviceProgram, run: IrrigationRunSummary) => {
    const key = `skip:${row.deviceId}:${run.run_id}`;
    setBusyKey(key);
    setActionFeedback('Skipping to the next zone...');
    try {
      const result = await mobileApi.skipIrrigationProgramRunStep(row.deviceId, run.run_id);
      const nextStep = result.run.steps.find((step) => step.status === 'running');
      setActiveRuns((prev) => {
        if (result.run.status === 'running') return { ...prev, [row.deviceId]: result.run };
        const next = { ...prev };
        delete next[row.deviceId];
        return next;
      });
      setActionFeedback(nextStep ? `Skipped to ${nextStep.zone_name || nextStep.local_ref}.` : `${row.program.name} completed.`);
      setBusyKey('');
      reloadPrograms(selectedSite).catch(console.error);
    } catch (error) {
      setActionFeedback(String(error));
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

  const updateProgramZoneDraft = (row: DeviceProgram, zone: IrrigationZone, patch: Partial<{ enabled: boolean; durationSeconds: number }>) => {
    const key = programKey(row);
    setProgramZoneDrafts((prev) => {
      const existing = prev[key]?.[zone.zone_id] || { enabled: false, durationSeconds: 600 };
      return {
        ...prev,
        [key]: {
          ...(prev[key] || {}),
          [zone.zone_id]: {
            ...existing,
            ...patch,
          },
        },
      };
    });
  };

  const saveProgramZones = async (row: DeviceProgram) => {
    const key = programKey(row);
    const draft = programZoneDrafts[key] || {};
    setBusyKey(`zones:${key}`);
    setActionFeedback('');
    try {
      await mobileApi.replaceIrrigationProgramZones(row.deviceId, row.program.program_id, {
        zones: row.availableZones
          .map((zone, index) => ({ zone, index, draft: draft[zone.zone_id] }))
          .filter((item) => item.draft?.enabled)
          .map((item) => ({
            zone_id: item.zone.zone_id,
            duration_seconds: Math.max(1, Number(item.draft?.durationSeconds || 600)),
            sort_order: item.index,
            enabled: true,
          })),
      });
      await reloadPrograms(selectedSite);
      setActionFeedback(`Saved zone runtimes for ${row.program.name}.`);
    } catch (error) {
      setActionFeedback(String(error));
    } finally {
      setBusyKey('');
    }
  };

  const updateScheduleDraft = (row: DeviceProgram, patch: Partial<ScheduleDraft>) => {
    const key = programKey(row);
    setScheduleDrafts((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || defaultScheduleDraft()),
        ...patch,
      },
    }));
  };

  const toggleDraftWeekday = (row: DeviceProgram, weekday: number) => {
    const key = programKey(row);
    const draft = scheduleDrafts[key] || defaultScheduleDraft();
    updateScheduleDraft(row, {
      weekdays: draft.weekdays.includes(weekday)
        ? draft.weekdays.filter((value) => value !== weekday)
        : [...draft.weekdays, weekday].sort((left, right) => left - right),
    });
  };

  const createSchedule = async (row: DeviceProgram) => {
    const key = programKey(row);
    const draft = scheduleDrafts[key] || defaultScheduleDraft();
    setBusyKey(`schedule:${key}`);
    setActionFeedback('');
    try {
      await mobileApi.createIrrigationProgramSchedule(row.deviceId, row.program.program_id, schedulePayloadFromDraft(draft, true));
      await reloadPrograms(selectedSite);
      setActionFeedback(`Schedule added to ${row.program.name}.`);
    } catch (error) {
      setActionFeedback(String(error));
    } finally {
      setBusyKey('');
    }
  };

  const updateScheduleEditDraft = (scheduleId: string, patch: Partial<ScheduleDraft>) => {
    setScheduleEditDrafts((prev) => ({
      ...prev,
      [scheduleId]: {
        ...(prev[scheduleId] || defaultScheduleDraft()),
        ...patch,
      },
    }));
  };

  const toggleEditDraftWeekday = (scheduleId: string, weekday: number) => {
    const draft = scheduleEditDrafts[scheduleId] || defaultScheduleDraft();
    updateScheduleEditDraft(scheduleId, {
      weekdays: draft.weekdays.includes(weekday)
        ? draft.weekdays.filter((value) => value !== weekday)
        : [...draft.weekdays, weekday].sort((left, right) => left - right),
    });
  };

  const saveSchedule = async (row: DeviceProgram, schedule: IrrigationScheduleSummary, enabled = schedule.enabled) => {
    const draft = scheduleEditDrafts[schedule.schedule_id] || scheduleToDraft(schedule);
    setBusyKey(`schedule-save:${schedule.schedule_id}`);
    setActionFeedback('');
    try {
      await mobileApi.updateIrrigationProgramSchedule(row.deviceId, row.program.program_id, schedule.schedule_id, schedulePayloadFromDraft(draft, enabled));
      await reloadPrograms(selectedSite);
      setActionFeedback(`Saved schedule ${draft.name.trim() || schedule.name}.`);
    } catch (error) {
      setActionFeedback(String(error));
    } finally {
      setBusyKey('');
    }
  };

  const deleteSchedule = async (row: DeviceProgram, schedule: IrrigationScheduleSummary) => {
    setBusyKey(`schedule-delete:${schedule.schedule_id}`);
    setActionFeedback('');
    try {
      await mobileApi.deleteIrrigationProgramSchedule(row.deviceId, row.program.program_id, schedule.schedule_id);
      await reloadPrograms(selectedSite);
      setActionFeedback(`Deleted schedule ${schedule.name}.`);
    } catch (error) {
      setActionFeedback(String(error));
    } finally {
      setBusyKey('');
    }
  };

  useEffect(() => {
    setProgramZoneDrafts((prev) => {
      const next = { ...prev };
      for (const row of programRows) {
        const key = programKey(row);
        const selectedByZoneId = new Map(row.programZones.map((zone) => [zone.zone_id, zone]));
        next[key] = row.availableZones.reduce<ProgramZoneDraft>((draft, zone) => {
          const existing = next[key]?.[zone.zone_id];
          const selected = selectedByZoneId.get(zone.zone_id);
          draft[zone.zone_id] = existing || {
            enabled: Boolean(selected),
            durationSeconds: selected?.duration_seconds || 600,
          };
          return draft;
        }, {});
      }
      return next;
    });
    setScheduleDrafts((prev) => {
      const next = { ...prev };
      for (const row of programRows) {
        const key = programKey(row);
        next[key] = next[key] || defaultScheduleDraft();
      }
      return next;
    });
    setScheduleEditDrafts((prev) => {
      const next = { ...prev };
      for (const row of programRows) {
        for (const schedule of row.schedules) {
          next[schedule.schedule_id] = next[schedule.schedule_id] || scheduleToDraft(schedule);
        }
      }
      return next;
    });
  }, [programRows]);

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

  useEffect(() => {
    if (!selectedSite) return undefined;
    const intervalId = window.setInterval(() => {
      reloadPrograms(selectedSite).catch(console.error);
    }, 8000);
    return () => window.clearInterval(intervalId);
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
            const key = programKey(row);
            const scheduleSummary = row.schedules.length
              ? row.schedules.map(scheduleSummaryLabel).join(' | ')
              : 'No schedules defined';
            const zoneDraft = programZoneDrafts[key] || {};
            const scheduleDraft = scheduleDrafts[key] || defaultScheduleDraft();
            const latestForDevice = events.find((event) => event.device_id === row.deviceId);
            const activeRun = activeRuns[row.deviceId];
            const activeProgram = activeRun?.program_id === row.program.program_id;
            const currentStep = activeProgram ? activeRun.steps.find((step) => step.status === 'running') : undefined;
            const nextStep = activeProgram ? activeRun.steps.find((step) => step.status === 'planned') : undefined;
            const hasOtherActiveProgram = Boolean(activeRun && !activeProgram);
            const runBusy = busyKey === `run:${row.deviceId}:${row.program.program_id}`;
            const stopBusy = activeRun ? busyKey === `stop:${row.deviceId}:${activeRun.run_id}` : false;
            const skipBusy = activeRun ? busyKey === `skip:${row.deviceId}:${activeRun.run_id}` : false;
            const estimateLiters = Math.max(60, Math.round(row.program.seasonal_adjustment * Math.max(1, row.schedules.length) * 120));
            return (
            <section key={`${row.deviceId}:${row.program.program_id}`} className={`rounded-2xl app-surface p-4 shadow-soft border border-slate-100 ${hasOtherActiveProgram ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{row.program.name}</h2>
                  <p className="text-sm text-muted">{row.displayName} • {scheduleSummary}</p>
                </div>
                <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                  <span>{row.program.enabled ? 'Enabled' : 'Not Enabled'}</span>
                  <IonToggle
                    checked={row.program.enabled}
                    disabled={busyKey === `toggle:${row.deviceId}:${row.program.program_id}`}
                    onIonChange={() => { void toggleProgramEnabled(row); }}
                  />
                </label>
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

              <div className="mt-3 rounded-xl border border-slate-200 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted">Run status</p>
                <p className="text-sm font-semibold mt-1">
                  {runBusy
                    ? 'Starting program...'
                    : activeProgram && currentStep
                      ? `Running ${currentStep.zone_name || currentStep.local_ref || 'zone'}`
                      : hasOtherActiveProgram
                        ? 'Another program is running on this controller'
                        : 'Idle'}
                </p>
                {activeProgram && currentStep ? (
                  <p className="text-xs text-muted mt-1">
                    Current runtime {Math.round(currentStep.duration_seconds / 60)} min{nextStep ? ` • Next ${nextStep.zone_name || nextStep.local_ref}` : ' • Last zone'}
                  </p>
                ) : null}
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted">Program zones</p>
                    <p className="text-sm font-semibold mt-1">Select zones and standard runtimes</p>
                  </div>
                  <IonButton
                    size="small"
                    fill="outline"
                    disabled={busyKey === `zones:${key}`}
                    onClick={() => { void saveProgramZones(row); }}
                  >
                    {busyKey === `zones:${key}` ? 'Saving...' : 'Save zones'}
                  </IonButton>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {row.availableZones.map((zone) => {
                    const draft = zoneDraft[zone.zone_id] || { enabled: false, durationSeconds: 600 };
                    return (
                      <div key={zone.zone_id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                        <label className="flex items-center justify-between gap-3 text-sm font-semibold">
                          <span>{zone.name || zone.local_ref}</span>
                          <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={(event) => updateProgramZoneDraft(row, zone, { enabled: event.target.checked })}
                          />
                        </label>
                        <label className="mt-2 block text-xs text-muted">
                          Runtime minutes
                          <input
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                            type="number"
                            min="1"
                            max="1440"
                            value={Math.max(1, Math.round(draft.durationSeconds / 60))}
                            disabled={!draft.enabled}
                            onChange={(event) => updateProgramZoneDraft(row, zone, { durationSeconds: Math.max(1, Number(event.target.value || 1)) * 60 })}
                          />
                        </label>
                      </div>
                    );
                  })}
                  {!row.availableZones.length ? <p className="text-sm text-muted">No zones configured for this controller.</p> : null}
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 px-3 py-3">
                <p className="text-xs uppercase tracking-wide text-muted">Schedule</p>
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <input
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    placeholder="Schedule name"
                    value={scheduleDraft.name}
                    onChange={(event) => updateScheduleDraft(row, { name: event.target.value })}
                  />
                  <input
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    type="time"
                    value={scheduleDraft.startLocalTime}
                    onChange={(event) => updateScheduleDraft(row, { startLocalTime: event.target.value })}
                  />
                  <select
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                    value={scheduleDraft.recurrenceType}
                    onChange={(event) => updateScheduleDraft(row, { recurrenceType: event.target.value })}
                  >
                    <option value="weekdays">Weekdays</option>
                    <option value="odd_days">Odd days</option>
                    <option value="even_days">Even days</option>
                    <option value="cyclic">Cyclic</option>
                    <option value="custom_dates">Custom dates</option>
                  </select>
                  <IonButton
                    size="small"
                    disabled={busyKey === `schedule:${key}`}
                    onClick={() => { void createSchedule(row); }}
                  >
                    {busyKey === `schedule:${key}` ? 'Adding...' : 'Add schedule'}
                  </IonButton>
                </div>
                {scheduleDraft.recurrenceType === 'weekdays' ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {weekdayOptions.map((weekday) => (
                      <label key={weekday.value} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={scheduleDraft.weekdays.includes(weekday.value)}
                          onChange={() => toggleDraftWeekday(row, weekday.value)}
                        />
                        {weekday.label}
                      </label>
                    ))}
                  </div>
                ) : null}
                {scheduleDraft.recurrenceType === 'cyclic' ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <label className="text-xs text-muted">
                      Every N days
                      <input
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        type="number"
                        min="1"
                        max="366"
                        value={scheduleDraft.intervalDays}
                        onChange={(event) => updateScheduleDraft(row, { intervalDays: Math.max(1, Number(event.target.value || 1)) })}
                      />
                    </label>
                    <label className="text-xs text-muted">
                      Start date
                      <input
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        type="date"
                        value={scheduleDraft.anchorDate}
                        onChange={(event) => updateScheduleDraft(row, { anchorDate: event.target.value })}
                      />
                    </label>
                  </div>
                ) : null}
                {scheduleDraft.recurrenceType === 'custom_dates' ? (
                  <textarea
                    className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    rows={2}
                    placeholder="YYYY-MM-DD, YYYY-MM-DD"
                    value={scheduleDraft.datesText}
                    onChange={(event) => updateScheduleDraft(row, { datesText: event.target.value })}
                  />
                ) : null}
                {row.schedules.length ? (
                  <div className="mt-3 space-y-2">
                    {row.schedules.map((schedule) => (
                      <div key={schedule.schedule_id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted">Existing schedule</p>
                            <p className="text-sm font-semibold mt-1">{scheduleSummaryLabel(schedule)}</p>
                          </div>
                          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                            <span>{schedule.enabled ? 'Enabled' : 'Not Enabled'}</span>
                            <input
                              type="checkbox"
                              checked={schedule.enabled}
                              disabled={busyKey === `schedule-save:${schedule.schedule_id}`}
                              onChange={(event) => { void saveSchedule(row, schedule, event.target.checked); }}
                            />
                          </label>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                          <input
                            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                            value={(scheduleEditDrafts[schedule.schedule_id] || scheduleToDraft(schedule)).name}
                            onChange={(event) => updateScheduleEditDraft(schedule.schedule_id, { name: event.target.value })}
                          />
                          <input
                            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                            type="time"
                            value={(scheduleEditDrafts[schedule.schedule_id] || scheduleToDraft(schedule)).startLocalTime}
                            onChange={(event) => updateScheduleEditDraft(schedule.schedule_id, { startLocalTime: event.target.value })}
                          />
                          <select
                            className="rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                            value={(scheduleEditDrafts[schedule.schedule_id] || scheduleToDraft(schedule)).recurrenceType}
                            onChange={(event) => updateScheduleEditDraft(schedule.schedule_id, { recurrenceType: event.target.value })}
                          >
                            <option value="weekdays">Weekdays</option>
                            <option value="odd_days">Odd days</option>
                            <option value="even_days">Even days</option>
                            <option value="cyclic">Cyclic</option>
                            <option value="custom_dates">Custom dates</option>
                          </select>
                          <div className="flex gap-2">
                            <IonButton
                              size="small"
                              fill="outline"
                              disabled={busyKey === `schedule-save:${schedule.schedule_id}`}
                              onClick={() => { void saveSchedule(row, schedule); }}
                            >
                              {busyKey === `schedule-save:${schedule.schedule_id}` ? 'Saving...' : 'Save'}
                            </IonButton>
                            <IonButton
                              size="small"
                              color="danger"
                              fill="outline"
                              disabled={busyKey === `schedule-delete:${schedule.schedule_id}`}
                              onClick={() => { void deleteSchedule(row, schedule); }}
                            >
                              {busyKey === `schedule-delete:${schedule.schedule_id}` ? 'Deleting...' : 'Delete'}
                            </IonButton>
                          </div>
                        </div>
                        {(scheduleEditDrafts[schedule.schedule_id] || scheduleToDraft(schedule)).recurrenceType === 'weekdays' ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {weekdayOptions.map((weekday) => (
                              <label key={weekday.value} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={(scheduleEditDrafts[schedule.schedule_id] || scheduleToDraft(schedule)).weekdays.includes(weekday.value)}
                                  onChange={() => toggleEditDraftWeekday(schedule.schedule_id, weekday.value)}
                                />
                                {weekday.label}
                              </label>
                            ))}
                          </div>
                        ) : null}
                        {(scheduleEditDrafts[schedule.schedule_id] || scheduleToDraft(schedule)).recurrenceType === 'cyclic' ? (
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            <label className="text-xs text-muted">
                              Every N days
                              <input
                                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                                type="number"
                                min="1"
                                max="366"
                                value={(scheduleEditDrafts[schedule.schedule_id] || scheduleToDraft(schedule)).intervalDays}
                                onChange={(event) => updateScheduleEditDraft(schedule.schedule_id, { intervalDays: Math.max(1, Number(event.target.value || 1)) })}
                              />
                            </label>
                            <label className="text-xs text-muted">
                              Start date
                              <input
                                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                                type="date"
                                value={(scheduleEditDrafts[schedule.schedule_id] || scheduleToDraft(schedule)).anchorDate}
                                onChange={(event) => updateScheduleEditDraft(schedule.schedule_id, { anchorDate: event.target.value })}
                              />
                            </label>
                          </div>
                        ) : null}
                        {(scheduleEditDrafts[schedule.schedule_id] || scheduleToDraft(schedule)).recurrenceType === 'custom_dates' ? (
                          <textarea
                            className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                            rows={2}
                            placeholder="YYYY-MM-DD, YYYY-MM-DD"
                            value={(scheduleEditDrafts[schedule.schedule_id] || scheduleToDraft(schedule)).datesText}
                            onChange={(event) => updateScheduleEditDraft(schedule.schedule_id, { datesText: event.target.value })}
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                <IonButton
                  size="small"
                  disabled={runBusy || Boolean(activeRun) || !row.program.enabled}
                  onClick={() => { void runProgramNow(row); }}
                >
                  {runBusy ? 'Starting...' : 'Run now'}
                </IonButton>
                {activeProgram ? (
                  <>
                    <IonButton
                      size="small"
                      color="danger"
                      disabled={stopBusy || skipBusy}
                      onClick={() => { void stopProgramRun(row, activeRun); }}
                    >
                      {stopBusy ? 'Stopping...' : 'Stop'}
                    </IonButton>
                    <IonButton
                      size="small"
                      fill="outline"
                      disabled={stopBusy || skipBusy}
                      onClick={() => { void skipProgramRunStep(row, activeRun); }}
                    >
                      {skipBusy ? 'Skipping...' : 'Skip next'}
                    </IonButton>
                  </>
                ) : null}
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
