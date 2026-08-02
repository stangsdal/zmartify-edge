import { IonButton, IonContent, IonPage, IonToggle } from '@ionic/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { SiteSelector } from '../components/SiteSelector';
import {
  mobileApi,
  MobileEvent,
  MobileSiteSummary,
  IrrigationDeviceOverview,
  IrrigationProgramSummary,
  IrrigationProgramZoneSummary,
  IrrigationRunSummary,
  IrrigationScheduleSummary,
  IrrigationZone,
  subscribeRealtimeTopics,
} from '../api/mobile';
import { toIrrigationFeedback } from '../utils/irrigationErrors';

type DeviceProgram = {
  deviceId: string;
  displayName: string;
  program: IrrigationProgramSummary;
  availableZones: IrrigationZone[];
  programZones: IrrigationProgramZoneSummary[];
  schedules: IrrigationScheduleSummary[];
  runtime?: IrrigationDeviceOverview['runtime'];
};

type ProgramZoneDraft = Record<string, { enabled: boolean; durationSeconds: number; runGroup: number }>;

const programZoneDraftEquals = (left: ProgramZoneDraft | undefined, right: ProgramZoneDraft | undefined): boolean => {
  const leftEntries = Object.entries(left || {});
  const rightEntries = Object.entries(right || {});
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  return leftEntries.every(([zoneId, zoneDraft]) => {
    const other = right?.[zoneId];
    if (!other) {
      return false;
    }
    return other.enabled === zoneDraft.enabled
      && other.durationSeconds === zoneDraft.durationSeconds
      && other.runGroup === zoneDraft.runGroup;
  });
};

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

const formatRemaining = (seconds: number): string => {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  }
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const parseTimestampMs = (value?: string | null): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const RUNTIME_SIGNAL_MAX_AGE_SECONDS = 180;

const isIrrigationController = (device: { device_id: string; display_name: string; device_type?: string | null; integration_mode?: string | null }): boolean => {
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
  const [programZoneServerDrafts, setProgramZoneServerDrafts] = useState<Record<string, ProgramZoneDraft>>({});
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, ScheduleDraft>>({});
  const [scheduleEditDrafts, setScheduleEditDrafts] = useState<Record<string, ScheduleDraft>>({});
  const [scheduleComposerOpen, setScheduleComposerOpen] = useState<Record<string, boolean>>({});
  const [activeRuns, setActiveRuns] = useState<Record<string, IrrigationRunSummary>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());

  const reconcileActiveRun = useCallback((deviceId: string, run?: IrrigationRunSummary | null) => {
    setActiveRuns((prev) => {
      const next = { ...prev };
      if (run && run.status === 'running') {
        next[deviceId] = run;
      } else {
        delete next[deviceId];
      }
      return next;
    });
  }, []);

  const reloadPrograms = useCallback(async (siteId: string) => {
    const overview = await mobileApi.getIrrigationOverview(siteId).catch(() => null);
    const overviewDevices = (overview?.devices || [])
      .filter(isIrrigationController)
      .map((device) => ({
        device_id: device.device_id,
        display_name: device.display_name,
        runtime: device.runtime || null,
      }));
    let irrigationDevices = overviewDevices;
    if (!irrigationDevices.length) {
      const site = await mobileApi.getSite(siteId);
      irrigationDevices = site.devices.filter(isIrrigationController).map((device) => ({
        device_id: device.device_id,
        display_name: device.display_name,
        runtime: null,
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
              runtime: device.runtime || null,
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
      reconcileActiveRun(row.deviceId, result.run);
      const currentStep = result.run.steps.find((step) => step.status === 'running');
      setActionFeedback(`Run started for ${row.program.name}${currentStep ? ` on ${currentStep.zone_name || currentStep.local_ref}` : ''}.`);
      setBusyKey('');
      reloadPrograms(selectedSite).catch(console.error);
      window.setTimeout(() => {
        reloadPrograms(selectedSite).catch(console.error);
      }, 1500);
    } catch (error) {
      setActionFeedback(toIrrigationFeedback(error));
      setBusyKey('');
    }
  };

  const stopProgramRun = async (row: DeviceProgram, run?: IrrigationRunSummary | null) => {
    const key = run ? `stop:${row.deviceId}:${run.run_id}` : `stop-controller:${row.deviceId}:${row.program.program_id}`;
    setBusyKey(key);
    setActionFeedback('Stopping program...');
    try {
      if (run) {
        await mobileApi.stopIrrigationProgramRun(row.deviceId, run.run_id);
        reconcileActiveRun(row.deviceId, null);
      } else {
        await mobileApi.publishIrrigationCommand(row.deviceId, {
          command_type: 'irrigation.stop_all',
          parameters: {},
        });
      }
      setActionFeedback(`Stopped ${row.program.name}.`);
      setBusyKey('');
      reloadPrograms(selectedSite).catch(console.error);
      window.setTimeout(() => {
        reloadPrograms(selectedSite).catch(console.error);
      }, 1500);
    } catch (error) {
      setActionFeedback(toIrrigationFeedback(error));
      setBusyKey('');
    }
  };

  const skipProgramRunStep = async (row: DeviceProgram, run?: IrrigationRunSummary | null) => {
    const key = run ? `skip:${row.deviceId}:${run.run_id}` : `skip-controller:${row.deviceId}:${row.program.program_id}`;
    setBusyKey(key);
    setActionFeedback('Skipping to the next zone...');
    try {
      if (run) {
        const result = await mobileApi.skipIrrigationProgramRunStep(row.deviceId, run.run_id);
        const nextStep = result.run.steps.find((step) => step.status === 'running');
        reconcileActiveRun(row.deviceId, result.run);
        setActionFeedback(
          result.run.trigger_type === 'manual_controller'
            ? 'Skip requested on controller.'
            : nextStep
              ? `Skipped to ${nextStep.zone_name || nextStep.local_ref}.`
              : `${row.program.name} completed.`
        );
      } else {
        await mobileApi.publishIrrigationCommand(row.deviceId, {
          command_type: 'irrigation.program.skip',
          parameters: {},
        });
        setActionFeedback('Skip requested on controller.');
      }
      setBusyKey('');
      reloadPrograms(selectedSite).catch(console.error);
      window.setTimeout(() => {
        reloadPrograms(selectedSite).catch(console.error);
      }, 1500);
    } catch (error) {
      setActionFeedback(toIrrigationFeedback(error));
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
      setActionFeedback(toIrrigationFeedback(error));
    } finally {
      setBusyKey('');
    }
  };

  const deleteProgram = async (row: DeviceProgram) => {
    const confirmed = window.confirm(`Delete program "${row.program.name}"? This also removes its zones and schedules.`);
    if (!confirmed) {
      return;
    }

    const key = `program-delete:${row.deviceId}:${row.program.program_id}`;
    setBusyKey(key);
    setActionFeedback('');
    try {
      await mobileApi.deleteIrrigationProgram(row.deviceId, row.program.program_id);
      await reloadPrograms(selectedSite);
      setActionFeedback(`Deleted program ${row.program.name}.`);
    } catch (error) {
      setActionFeedback(toIrrigationFeedback(error));
    } finally {
      setBusyKey('');
    }
  };

  const updateProgramZoneDraft = (row: DeviceProgram, zone: IrrigationZone, patch: Partial<{ enabled: boolean; durationSeconds: number; runGroup: number }>) => {
    const key = programKey(row);
    setProgramZoneDrafts((prev) => {
      const existing = prev[key]?.[zone.zone_id] || { enabled: false, durationSeconds: 600, runGroup: 1 };
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
    const committedDraft = row.availableZones.reduce<ProgramZoneDraft>((nextDraft, zone) => {
      const zoneDraft = draft[zone.zone_id];
      nextDraft[zone.zone_id] = zoneDraft
        ? {
            enabled: Boolean(zoneDraft.enabled),
            durationSeconds: Math.max(1, Number(zoneDraft.durationSeconds || 600)),
            runGroup: Math.max(1, Math.min(15, Number(zoneDraft.runGroup || 1))),
          }
        : {
            enabled: false,
            durationSeconds: 600,
            runGroup: 1,
          };
      return nextDraft;
    }, {});
    setBusyKey(`zones:${key}`);
    setActionFeedback('');
    try {
      const groupCounts = Object.values(committedDraft)
        .filter((zone) => zone.enabled)
        .reduce<Record<number, number>>((counts, zone) => {
          counts[zone.runGroup] = (counts[zone.runGroup] || 0) + 1;
          return counts;
        }, {});
      if (Object.values(groupCounts).some((count) => count > 2)) {
        throw new Error('A run group can contain at most two enabled zones.');
      }
      await mobileApi.replaceIrrigationProgramZones(row.deviceId, row.program.program_id, {
        zones: row.availableZones
          .map((zone) => ({ zone, draft: draft[zone.zone_id] }))
          .filter((item) => item.draft?.enabled)
          .map((item) => ({
            zone_id: item.zone.zone_id,
            duration_seconds: Math.max(1, Number(item.draft?.durationSeconds || 600)),
            sort_order: Math.max(1, Math.min(15, Number(item.draft?.runGroup || 1))),
            enabled: true,
          })),
      });
      setProgramZoneDrafts((prev) => ({
        ...prev,
        [key]: committedDraft,
      }));
      setProgramZoneServerDrafts((prev) => ({
        ...prev,
        [key]: committedDraft,
      }));
      await reloadPrograms(selectedSite);
      setActionFeedback(`Saved zone runtimes for ${row.program.name}.`);
    } catch (error) {
      setActionFeedback(toIrrigationFeedback(error));
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
      setScheduleDrafts((prev) => ({
        ...prev,
        [key]: defaultScheduleDraft(),
      }));
      setScheduleComposerOpen((prev) => ({
        ...prev,
        [key]: false,
      }));
      await reloadPrograms(selectedSite);
      setActionFeedback(`Schedule added to ${row.program.name}.`);
    } catch (error) {
      setActionFeedback(toIrrigationFeedback(error));
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
      setActionFeedback(toIrrigationFeedback(error));
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
      setActionFeedback(toIrrigationFeedback(error));
    } finally {
      setBusyKey('');
    }
  };

  useEffect(() => {
    const nextServerDrafts: Record<string, ProgramZoneDraft> = {};
    for (const row of programRows) {
      const key = programKey(row);
      const selectedByZoneId = new Map(row.programZones.map((zone) => [zone.zone_id, zone]));
      nextServerDrafts[key] = row.availableZones.reduce<ProgramZoneDraft>((draft, zone) => {
        const selected = selectedByZoneId.get(zone.zone_id);
        draft[zone.zone_id] = {
          enabled: Boolean(selected),
          durationSeconds: selected?.duration_seconds || 600,
          runGroup: Math.max(1, Number(selected?.sort_order || zone.zone_id || 1)),
        };
        return draft;
      }, {});
    }

    setProgramZoneDrafts((prev) => {
      const next: Record<string, ProgramZoneDraft> = {};
      for (const row of programRows) {
        const key = programKey(row);
        const serverDraft = nextServerDrafts[key];
        const existingDraft = prev[key];
        const previousServerDraft = programZoneServerDrafts[key];
        next[key] = !existingDraft || programZoneDraftEquals(existingDraft, previousServerDraft)
          ? serverDraft
          : existingDraft;
      }
      return next;
    });
    setProgramZoneServerDrafts(nextServerDrafts);
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
  }, [programRows, programZoneServerDrafts]);

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
      setActionFeedback(toIrrigationFeedback(error));
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

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

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
            const controllerLocalProgramRun = activeProgram && activeRun?.trigger_type === 'manual_controller';
            const hasOtherActiveProgram = Boolean(activeRun && !activeProgram);
            const runBusy = busyKey === `run:${row.deviceId}:${row.program.program_id}`;
            const stopBusy = activeRun
              ? busyKey === `stop:${row.deviceId}:${activeRun.run_id}`
              : busyKey === `stop-controller:${row.deviceId}:${row.program.program_id}`;
            const skipBusy = activeRun
              ? busyKey === `skip:${row.deviceId}:${activeRun.run_id}`
              : busyKey === `skip-controller:${row.deviceId}:${row.program.program_id}`;
            const deleteProgramBusy = busyKey === `program-delete:${row.deviceId}:${row.program.program_id}`;
            const runtimeTimestampMs = parseTimestampMs(row.runtime?.source_timestamp) || parseTimestampMs(row.runtime?.updated_at);
            const runtimeAgeSeconds = runtimeTimestampMs == null ? null : Math.max(0, Math.floor((nowMs - runtimeTimestampMs) / 1000));
            const runtimeRemainingSeconds = row.runtime?.remaining_seconds == null
              ? null
              : Math.max(0, row.runtime.remaining_seconds - (runtimeAgeSeconds ?? 0));
            const runtimeProgramName = (row.runtime?.active_program_name || '').trim();
            const runtimeProgramMatches = runtimeProgramName.length > 0 && runtimeProgramName === row.program.name;
            const runtimeShowsActiveZone = Boolean(row.runtime?.active_zone_id && row.runtime.active_zone_id > 0);
            const runtimeSignalIsFresh = runtimeAgeSeconds != null && runtimeAgeSeconds <= RUNTIME_SIGNAL_MAX_AGE_SECONDS;
            const runtimeShowsActiveProgram = runtimeSignalIsFresh
              && runtimeProgramMatches
              && (runtimeShowsActiveZone || (runtimeRemainingSeconds != null && runtimeRemainingSeconds > 0));
            const currentStepStartMs = parseTimestampMs(currentStep?.started_at);
            const liveCurrentStepRemainingSeconds = currentStep == null
              ? null
              : Math.max(0, currentStep.duration_seconds - Math.floor((nowMs - (currentStepStartMs || nowMs)) / 1000));
            const displayControllerLocalProgramRun = controllerLocalProgramRun || (!activeProgram && runtimeShowsActiveProgram);
            const hasOtherRuntimeProgram = runtimeSignalIsFresh
              && !activeProgram
              && Boolean(runtimeProgramName)
              && !runtimeProgramMatches
              && (runtimeShowsActiveZone || (runtimeRemainingSeconds != null && runtimeRemainingSeconds > 0));
            const estimateLiters = Math.max(60, Math.round(row.program.seasonal_adjustment * Math.max(1, row.schedules.length) * 120));
            return (
            <section key={`${row.deviceId}:${row.program.program_id}`} className={`rounded-2xl app-surface p-4 shadow-soft border border-slate-100 ${hasOtherActiveProgram || hasOtherRuntimeProgram ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{row.program.name}</h2>
                  <p className="text-sm text-muted">{row.displayName} • {scheduleSummary}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                    <span>{row.program.enabled ? 'Enabled' : 'Not Enabled'}</span>
                    <IonToggle
                      checked={row.program.enabled}
                      disabled={busyKey === `toggle:${row.deviceId}:${row.program.program_id}`}
                      onIonChange={() => { void toggleProgramEnabled(row); }}
                    />
                  </label>
                  <IonButton
                    size="small"
                    color="danger"
                    fill="outline"
                    disabled={deleteProgramBusy || Boolean(activeRun)}
                    onClick={() => { void deleteProgram(row); }}
                  >
                    {deleteProgramBusy ? 'Deleting...' : 'Delete program'}
                  </IonButton>
                </div>
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
                      : displayControllerLocalProgramRun && row.runtime?.active_zone_name
                        ? `Running ${row.runtime.active_zone_name}`
                      : displayControllerLocalProgramRun
                        ? 'Program running on controller'
                      : hasOtherActiveProgram || hasOtherRuntimeProgram
                        ? 'Another program is running on this controller'
                        : 'Idle'}
                </p>
                {activeProgram && currentStep ? (
                  <p className="text-xs text-muted mt-1">
                    Remaining {formatRemaining(liveCurrentStepRemainingSeconds ?? currentStep.duration_seconds)}{nextStep ? ` • Next ${nextStep.zone_name || nextStep.local_ref}` : ' • Last zone'}
                  </p>
                ) : displayControllerLocalProgramRun ? (
                  <p className="text-xs text-muted mt-1">
                    {runtimeRemainingSeconds != null
                      ? `Remaining ${formatRemaining(runtimeRemainingSeconds)}${row.runtime?.active_zone_name ? ` • ${row.runtime.active_zone_name}` : row.runtime?.active_zone_id ? ` • Zone ${row.runtime.active_zone_id}` : ''}`
                      : 'Zone sequencing is running locally on the controller.'}
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
                    const draft = zoneDraft[zone.zone_id] || { enabled: false, durationSeconds: 600, runGroup: 1 };
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
                        <label className="mt-2 block text-xs text-muted">
                          Run group
                          <input
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                            type="number"
                            min="1"
                            max="15"
                            value={draft.runGroup}
                            disabled={!draft.enabled}
                            onChange={(event) => updateProgramZoneDraft(row, zone, {
                              runGroup: Math.max(1, Math.min(15, Number(event.target.value || 1))),
                            })}
                          />
                        </label>
                      </div>
                    );
                  })}
                  {!row.availableZones.length ? <p className="text-sm text-muted">No zones configured for this controller.</p> : null}
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted">Schedule</p>
                    <p className="text-sm font-semibold mt-1">Add schedules first, then manage saved schedules below</p>
                  </div>
                  <IonButton
                    size="small"
                    disabled={busyKey === `schedule:${key}`}
                    onClick={() => setScheduleComposerOpen((prev) => ({ ...prev, [key]: !prev[key] }))}
                  >
                    {scheduleComposerOpen[key] ? 'Close' : 'Add schedule'}
                  </IonButton>
                </div>
                {scheduleComposerOpen[key] ? (
                  <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                    <p className="text-xs uppercase tracking-wide text-muted">New schedule</p>
                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      <input
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                        placeholder="Schedule name"
                        value={scheduleDraft.name}
                        onChange={(event) => updateScheduleDraft(row, { name: event.target.value })}
                      />
                      <input
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
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
                      <div className="flex gap-2">
                        <IonButton
                          size="small"
                          disabled={busyKey === `schedule:${key}`}
                          onClick={() => { void createSchedule(row); }}
                        >
                          {busyKey === `schedule:${key}` ? 'Adding...' : 'Add'}
                        </IonButton>
                        <IonButton
                          size="small"
                          fill="outline"
                          disabled={busyKey === `schedule:${key}`}
                          onClick={() => setScheduleComposerOpen((prev) => ({ ...prev, [key]: false }))}
                        >
                          Cancel
                        </IonButton>
                      </div>
                    </div>
                    {scheduleDraft.recurrenceType === 'weekdays' ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {weekdayOptions.map((weekday) => (
                          <label key={weekday.value} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
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
                            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
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
                            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                            type="date"
                            value={scheduleDraft.anchorDate}
                            onChange={(event) => updateScheduleDraft(row, { anchorDate: event.target.value })}
                          />
                        </label>
                      </div>
                    ) : null}
                    {scheduleDraft.recurrenceType === 'custom_dates' ? (
                      <textarea
                        className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                        rows={2}
                        placeholder="YYYY-MM-DD, YYYY-MM-DD"
                        value={scheduleDraft.datesText}
                        onChange={(event) => updateScheduleDraft(row, { datesText: event.target.value })}
                      />
                    ) : null}
                  </div>
                ) : null}
                {row.schedules.length ? (
                  <div className="mt-3 space-y-2">
                    {row.schedules.map((schedule) => (
                      <div key={schedule.schedule_id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted">Saved schedule</p>
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
                ) : (
                  <p className="mt-3 text-sm text-muted">No saved schedules yet.</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                <IonButton
                  size="small"
                  disabled={runBusy || Boolean(activeRun) || displayControllerLocalProgramRun || hasOtherRuntimeProgram || !row.program.enabled}
                  onClick={() => { void runProgramNow(row); }}
                >
                  {runBusy ? 'Starting...' : 'Run now'}
                </IonButton>
                {activeProgram || displayControllerLocalProgramRun ? (
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
