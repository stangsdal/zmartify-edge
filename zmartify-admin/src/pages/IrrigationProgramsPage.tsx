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

  const reloadPrograms = useCallback(async (siteId: string) => {
    const [site, overview] = await Promise.all([
      mobileApi.getSite(siteId),
      mobileApi.getIrrigationOverview(siteId).catch(() => null),
    ]);
    const siteDevices = site.devices.filter(isIrrigationController).map((device) => ({
      device_id: device.device_id,
      display_name: device.display_name,
    }));
    const overviewDevices = (overview?.devices || []).map((device) => ({
      device_id: device.device_id,
      display_name: device.display_name,
    }));
    const irrigationDevices = siteDevices.length ? siteDevices : overviewDevices;
    setDeviceIds(irrigationDevices.map((device) => device.device_id));
    const nextRows = await Promise.all(
      irrigationDevices.map(async (device) => {
        const [programsResponse, zonesResponse] = await Promise.all([
          mobileApi.listIrrigationPrograms(device.device_id),
          mobileApi.listIrrigationZones(device.device_id),
        ]);
        const availableZones = zonesResponse.zones || [];
        return Promise.all(
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
    const dates = draft.datesText
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    setBusyKey(`schedule:${key}`);
    setActionFeedback('');
    try {
      await mobileApi.createIrrigationProgramSchedule(row.deviceId, row.program.program_id, {
        name: draft.name.trim() || 'Schedule',
        start_local_time: draft.startLocalTime,
        weekdays: draft.recurrenceType === 'weekdays' ? draft.weekdays : [],
        recurrence_type: draft.recurrenceType,
        interval_days: draft.recurrenceType === 'cyclic' ? Math.max(1, Number(draft.intervalDays || 1)) : null,
        anchor_date: draft.recurrenceType === 'cyclic' ? draft.anchorDate : null,
        dates: draft.recurrenceType === 'custom_dates' ? dates : [],
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
            const estimateLiters = Math.max(60, Math.round(row.program.seasonal_adjustment * Math.max(1, row.schedules.length) * 120));
            return (
            <section key={`${row.deviceId}:${row.program.program_id}`} className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
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
                  <div className="mt-3 space-y-1">
                    {row.schedules.map((schedule) => (
                      <p key={schedule.schedule_id} className="text-xs text-muted">{schedule.name}: {scheduleSummaryLabel(schedule)}</p>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                <IonButton
                  size="small"
                  disabled={busyKey === `run:${row.deviceId}:${row.program.program_id}`}
                  onClick={() => { void runProgramNow(row); }}
                >
                  Run now
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
