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
  outputsActive?: number;
  activeZoneNames?: string[];
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
const MANUAL_RUN_PENDING_TIMEOUT_MS = 180000;

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
  const [groupZoneSelections, setGroupZoneSelections] = useState<Record<string, string>>({});
  const [groupRuntimeDrafts, setGroupRuntimeDrafts] = useState<Record<string, string>>({});
  const [programZoneServerDrafts, setProgramZoneServerDrafts] = useState<Record<string, ProgramZoneDraft>>({});
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, ScheduleDraft>>({});
  const [scheduleEditDrafts, setScheduleEditDrafts] = useState<Record<string, ScheduleDraft>>({});
  const [scheduleComposerOpen, setScheduleComposerOpen] = useState<Record<string, boolean>>({});
  const [activeRuns, setActiveRuns] = useState<Record<string, IrrigationRunSummary>>({});
  const [pendingManualRuns, setPendingManualRuns] = useState<Record<string, { programId: string; requestedAtMs: number }>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());

  const reconcileActiveRun = useCallback((deviceId: string, run?: IrrigationRunSummary | null) => {
    setActiveRuns((prev) => {
      const next = { ...prev };
      if (run && run.status === 'running') {
        next[deviceId] = run;
        setPendingManualRuns((pendingPrev) => {
          if (!pendingPrev[deviceId]) {
            return pendingPrev;
          }
          const pendingNext = { ...pendingPrev };
          delete pendingNext[deviceId];
          return pendingNext;
        });
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
        outputs_active: typeof device.outputs?.active === 'number' ? device.outputs.active : 0,
      }));
    let irrigationDevices = overviewDevices;
    if (!irrigationDevices.length) {
      const site = await mobileApi.getSite(siteId);
      irrigationDevices = site.devices.filter(isIrrigationController).map((device) => ({
        device_id: device.device_id,
        display_name: device.display_name,
        runtime: null,
        outputs_active: 0,
      }));
    }
    setDeviceIds(irrigationDevices.map((device) => device.device_id));
    const deviceProgramGroups = await Promise.all(
      irrigationDevices.map(async (device) => {
        const [programsResponse, zonesResponse, runsResponse, outputResponse] = await Promise.all([
          mobileApi.listIrrigationPrograms(device.device_id),
          mobileApi.listIrrigationZones(device.device_id),
          mobileApi.listIrrigationRuns(device.device_id, 20),
          mobileApi.listIrrigationOutputs(device.device_id),
        ]);
        const availableZones = zonesResponse.zones || [];
        const activeOutputZoneNumbers = new Set(
          outputResponse.outputs
            .filter((output) => output.active && !output.is_master_valve)
            .map((output) => Number((output.local_ref || output.output_id).match(/(\d+)$/)?.[1]))
            .filter((zoneNumber) => Number.isInteger(zoneNumber) && zoneNumber > 0),
        );
        const activeZoneNames = availableZones
          .filter((zone) => activeOutputZoneNumbers.has(Number((zone.local_ref || zone.zone_id).match(/(\d+)$/)?.[1])))
          .map((zone) => zone.name || zone.local_ref);
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
              outputsActive: device.outputs_active || 0,
              activeZoneNames,
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
    setPendingManualRuns((prev) => {
      const next = { ...prev };
      for (const group of deviceProgramGroups) {
        if (group.activeRun) {
          delete next[group.deviceId];
          continue;
        }
        const hasLikelyRuntimeActivity = group.rows.some((row) => {
          const runtime = row.runtime;
          const runtimeTs = parseTimestampMs(runtime?.source_timestamp) || parseTimestampMs(runtime?.updated_at);
          const runtimeAgeSeconds = runtimeTs == null ? null : Math.max(0, Math.floor((Date.now() - runtimeTs) / 1000));
          const runtimeSignalIsFresh = runtimeAgeSeconds != null && runtimeAgeSeconds <= RUNTIME_SIGNAL_MAX_AGE_SECONDS;
          return (runtimeSignalIsFresh && (
            Boolean(runtime?.active_zone_id && runtime.active_zone_id > 0) ||
            Boolean((runtime?.remaining_seconds || 0) > 0)
          )) || (row.outputsActive || 0) > 0;
        });
        if (hasLikelyRuntimeActivity) {
          delete next[group.deviceId];
        }
      }
      return next;
    });
  }, []);

  const runProgramNow = async (row: DeviceProgram) => {
    const key = `run:${row.deviceId}:${row.program.program_id}`;
    setBusyKey(key);
    setActionFeedback('');
    try {
      setPendingManualRuns((prev) => ({
        ...prev,
        [row.deviceId]: {
          programId: row.program.program_id,
          requestedAtMs: Date.now(),
        },
      }));
      const result = await mobileApi.startIrrigationProgramRun(row.deviceId, row.program.program_id);
      reconcileActiveRun(row.deviceId, result.run);
      const currentStep = result.run.steps.find((step) => step.status === 'running');
      if (result.run.status === 'running') {
        setPendingManualRuns((prev) => {
          if (!prev[row.deviceId]) {
            return prev;
          }
          const next = { ...prev };
          delete next[row.deviceId];
          return next;
        });
      }
      setActionFeedback(`Run started for ${row.program.name}${currentStep ? ` on ${currentStep.zone_name || currentStep.local_ref}` : ''}.`);
      setBusyKey('');
      reloadPrograms(selectedSite).catch(console.error);
      window.setTimeout(() => {
        reloadPrograms(selectedSite).catch(console.error);
      }, 1500);
    } catch (error) {
      setPendingManualRuns((prev) => {
        if (!prev[row.deviceId]) {
          return prev;
        }
        const next = { ...prev };
        delete next[row.deviceId];
        return next;
      });
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
      setPendingManualRuns((prev) => {
        if (!prev[row.deviceId]) {
          return prev;
        }
        const next = { ...prev };
        delete next[row.deviceId];
        return next;
      });
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

  const addWateringGroup = (row: DeviceProgram) => {
    const key = programKey(row);
    const draft = programZoneDrafts[key] || {};
    const nextZone = row.availableZones.find((zone) => !draft[zone.zone_id]?.enabled);
    if (!nextZone) {
      setActionFeedback('All configured zones are already assigned to a watering group.');
      return;
    }
    const highestGroup = Math.max(0, ...Object.values(draft).filter((item) => item.enabled).map((item) => item.runGroup));
    if (highestGroup >= 15) {
      setActionFeedback('A program can contain up to 15 watering groups.');
      return;
    }
    const nextGroup = highestGroup + 1;
    updateProgramZoneDraft(row, nextZone, { enabled: true, durationSeconds: 600, runGroup: nextGroup });
  };

  const removeWateringGroup = (row: DeviceProgram, runGroup: number) => {
    for (const zone of row.availableZones) {
      const draft = programZoneDrafts[programKey(row)]?.[zone.zone_id];
      if (draft?.enabled && draft.runGroup === runGroup) {
        updateProgramZoneDraft(row, zone, { enabled: false });
      }
    }
  };

  const updateWateringGroupDuration = (row: DeviceProgram, runGroup: number, durationSeconds: number) => {
    const key = programKey(row);
    setProgramZoneDrafts((prev) => {
      const currentDraft = prev[key] || {};
      const nextDraft = Object.fromEntries(Object.entries(currentDraft).map(([zoneId, zoneDraft]) => [
        zoneId,
        zoneDraft.enabled && zoneDraft.runGroup === runGroup
          ? { ...zoneDraft, durationSeconds }
          : zoneDraft,
      ]));
      return { ...prev, [key]: nextDraft };
    });
  };

  const saveProgramZones = async (row: DeviceProgram) => {
    const key = programKey(row);
    const draft = programZoneDrafts[key] || {};
    const groupDurations: Record<number, number> = {};
    const committedDraft = row.availableZones.reduce<ProgramZoneDraft>((nextDraft, zone) => {
      const zoneDraft = draft[zone.zone_id];
      const enabled = Boolean(zoneDraft?.enabled);
      const runGroup = Math.max(1, Math.min(15, Number(zoneDraft?.runGroup || 1)));
      const durationSeconds = Math.max(1, Number(zoneDraft?.durationSeconds || 600));
      const groupDuration = enabled ? (groupDurations[runGroup] ||= durationSeconds) : durationSeconds;
      nextDraft[zone.zone_id] = { enabled, durationSeconds: groupDuration, runGroup };
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
      if (Object.values(groupCounts).some((count) => count > 3)) {
        throw new Error('A watering group can contain at most three zones.');
      }
      await mobileApi.replaceIrrigationProgramZones(row.deviceId, row.program.program_id, {
        zones: row.availableZones
          .map((zone) => ({ zone, draft: committedDraft[zone.zone_id] }))
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
      setActionFeedback(`Saved watering groups for ${row.program.name}.`);
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
      const deviceId = deviceIds[0];
      const [programResponse, zonesResponse] = await Promise.all([
        mobileApi.createIrrigationProgram(deviceId, { name, enabled: true }),
        mobileApi.listIrrigationZones(deviceId),
      ]);
      await mobileApi.replaceIrrigationProgramZones(deviceId, programResponse.program.program_id, {
        zones: (zonesResponse.zones || []).map((zone, index) => ({
          zone_id: zone.zone_id,
          duration_seconds: 600,
          sort_order: index + 1,
          enabled: true,
        })),
      });
      setNewProgramName('');
      await reloadPrograms(selectedSite);
      setActionFeedback(`Program "${name}" created with one watering group per configured zone.`);
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

  useEffect(() => {
    setPendingManualRuns((prev) => {
      const now = Date.now();
      let changed = false;
      const next: Record<string, { programId: string; requestedAtMs: number }> = {};
      for (const [deviceId, pending] of Object.entries(prev)) {
        if (now - pending.requestedAtMs <= MANUAL_RUN_PENDING_TIMEOUT_MS) {
          next[deviceId] = pending;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [nowMs]);

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
            const outputsShowActive = (row.outputsActive || 0) > 0;
            const activeZoneLabel = (row.activeZoneNames || []).join(' + ');
            const runtimeSignalIsFresh = runtimeAgeSeconds != null && runtimeAgeSeconds <= RUNTIME_SIGNAL_MAX_AGE_SECONDS;
            const runtimeShowsActiveProgram = runtimeSignalIsFresh
              && runtimeProgramMatches
              && (runtimeShowsActiveZone || (runtimeRemainingSeconds != null && runtimeRemainingSeconds > 0) || outputsShowActive);
            const currentStepStartMs = parseTimestampMs(currentStep?.started_at);
            const liveCurrentStepRemainingSeconds = currentStep == null
              ? null
              : Math.max(0, currentStep.duration_seconds - Math.floor((nowMs - (currentStepStartMs || nowMs)) / 1000));
            const displayControllerLocalProgramRun = controllerLocalProgramRun || (!activeProgram && runtimeShowsActiveProgram);
            const hasOtherRuntimeProgram = runtimeSignalIsFresh
              && !activeProgram
              && Boolean(runtimeProgramName)
              && !runtimeProgramMatches
              && (runtimeShowsActiveZone || (runtimeRemainingSeconds != null && runtimeRemainingSeconds > 0) || outputsShowActive);
            const controllerHasUnattributedRun = !activeProgram
              && !displayControllerLocalProgramRun
              && !hasOtherRuntimeProgram
              && (outputsShowActive || (runtimeSignalIsFresh && (runtimeShowsActiveZone || (runtimeRemainingSeconds != null && runtimeRemainingSeconds > 0))));
            const pendingManual = pendingManualRuns[row.deviceId];
            const pendingForThisProgram = Boolean(pendingManual && pendingManual.programId === row.program.program_id);
            const controllerHasActiveProgram = Boolean(activeRun) || displayControllerLocalProgramRun || hasOtherRuntimeProgram || controllerHasUnattributedRun || Boolean(pendingManual);
            const showStopControls = activeProgram || displayControllerLocalProgramRun || pendingForThisProgram || controllerHasUnattributedRun;
            const estimateLiters = Math.max(60, Math.round(row.program.seasonal_adjustment * Math.max(1, row.schedules.length) * 120));
            const wateringGroups = Object.entries(zoneDraft)
              .filter(([, draft]) => draft.enabled)
              .reduce<Record<number, IrrigationZone[]>>((groups, [zoneId, draft]) => {
                const zone = row.availableZones.find((item) => item.zone_id === zoneId);
                if (zone) {
                  (groups[draft.runGroup] ||= []).push(zone);
                }
                return groups;
              }, {});
            const orderedWateringGroups = Object.entries(wateringGroups)
              .map(([runGroup, zones]) => ({ runGroup: Number(runGroup), zones }))
              .sort((left, right) => left.runGroup - right.runGroup);
            return (
            <section key={`${row.deviceId}:${row.program.program_id}`} className={`rounded-2xl app-surface p-4 shadow-soft border border-slate-100 ${hasOtherActiveProgram || hasOtherRuntimeProgram || controllerHasUnattributedRun ? 'opacity-60' : ''}`}>
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
                    : pendingForThisProgram
                      ? 'Starting program on controller...'
                    : activeProgram && currentStep
                      ? `Running ${currentStep.zone_name || currentStep.local_ref || 'zone'}`
                      : displayControllerLocalProgramRun && row.runtime?.active_zone_name
                        ? `Running ${row.runtime.active_zone_name}`
                      : displayControllerLocalProgramRun
                        ? 'Program running on controller'
                      : controllerHasUnattributedRun
                        ? activeZoneLabel
                          ? `Running ${activeZoneLabel}`
                          : row.runtime?.active_zone_name
                            ? `Running ${row.runtime.active_zone_name}`
                            : row.runtime?.active_zone_id
                              ? `Running Zone ${row.runtime.active_zone_id}`
                              : 'Program running on controller'
                      : hasOtherActiveProgram || hasOtherRuntimeProgram
                        ? 'Another program is running on this controller'
                        : 'Idle'}
                </p>
                {activeProgram && currentStep ? (
                  <p className="text-xs text-muted mt-1">
                    Remaining {formatRemaining(liveCurrentStepRemainingSeconds ?? currentStep.duration_seconds)}{nextStep ? ` • Next ${nextStep.zone_name || nextStep.local_ref}` : ' • Last zone'}
                  </p>
                ) : pendingForThisProgram ? (
                  <p className="text-xs text-muted mt-1">
                    Waiting for controller runtime confirmation. You can stop immediately if needed.
                  </p>
                ) : controllerHasUnattributedRun ? (
                  <p className="text-xs text-muted mt-1">
                    {runtimeRemainingSeconds != null
                      ? `Current zone remaining ${formatRemaining(runtimeRemainingSeconds)}.`
                      : 'Active outputs are confirmed by controller telemetry.'} Stop is available while program attribution catches up.
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
                    <p className="text-xs uppercase tracking-wide text-muted">Watering groups</p>
                    <p className="text-sm font-semibold mt-1">Each group runs together, then the next group begins</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <IonButton size="small" fill="outline" disabled={busyKey === `zones:${key}`} onClick={() => { void addWateringGroup(row); }}>
                      Add group
                    </IonButton>
                    <IonButton size="small" disabled={busyKey === `zones:${key}`} onClick={() => { void saveProgramZones(row); }}>
                      {busyKey === `zones:${key}` ? 'Saving...' : 'Save groups'}
                    </IonButton>
                  </div>
                </div>
                {orderedWateringGroups.length ? (
                  <div className="mt-3 grid gap-3">
                    {orderedWateringGroups.map((group, index) => {
                      const groupKey = `${key}:${group.runGroup}`;
                      const availableZones = row.availableZones.filter((zone) => !zoneDraft[zone.zone_id]?.enabled);
                      const groupRuntimeMinutes = Math.max(1, Math.round((zoneDraft[group.zones[0]?.zone_id]?.durationSeconds || 600) / 60));
                      return (
                        <div key={group.runGroup} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold">Group {index + 1} · Water together</p>
                            <div className="flex flex-wrap items-end gap-2">
                              <label className="block text-xs text-muted">
                                Runtime minutes
                                <input
                                  className="mt-1 w-28 rounded-lg border border-slate-200 px-2 py-1 text-sm bg-white"
                                  type="number"
                                  min="1"
                                  max="1440"
                                  value={groupRuntimeDrafts[groupKey] ?? String(groupRuntimeMinutes)}
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setGroupRuntimeDrafts((prev) => ({ ...prev, [groupKey]: nextValue }));
                                    const enteredMinutes = Number(nextValue);
                                    if (Number.isFinite(enteredMinutes) && enteredMinutes >= 1) {
                                      updateWateringGroupDuration(row, group.runGroup, Math.min(1440, Math.round(enteredMinutes)) * 60);
                                    }
                                  }}
                                  onBlur={() => {
                                    const enteredMinutes = Number(groupRuntimeDrafts[groupKey]);
                                    if (!Number.isFinite(enteredMinutes) || enteredMinutes < 1) {
                                      setGroupRuntimeDrafts((prev) => ({ ...prev, [groupKey]: String(groupRuntimeMinutes) }));
                                      return;
                                    }
                                    const normalizedMinutes = Math.min(1440, Math.round(enteredMinutes));
                                    updateWateringGroupDuration(row, group.runGroup, normalizedMinutes * 60);
                                    setGroupRuntimeDrafts((prev) => ({ ...prev, [groupKey]: String(normalizedMinutes) }));
                                  }}
                                />
                              </label>
                              <IonButton size="small" fill="clear" color="danger" onClick={() => removeWateringGroup(row, group.runGroup)}>
                                Delete group
                              </IonButton>
                            </div>
                          </div>
                          <div className="mt-2 grid gap-2 md:grid-cols-3">
                            {group.zones.map((zone) => (
                              <div key={zone.zone_id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                <p className="text-sm font-semibold">{zone.name || zone.local_ref}</p>
                                <IonButton size="small" fill="clear" color="medium" onClick={() => updateProgramZoneDraft(row, zone, { enabled: false })}>Remove zone</IonButton>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <select className="min-w-48 rounded-lg border border-slate-200 px-2 py-1 text-sm bg-white" value={groupZoneSelections[groupKey] || ''} onChange={(event) => setGroupZoneSelections((prev) => ({ ...prev, [groupKey]: event.target.value }))}>
                              <option value="">Add an unassigned zone</option>
                              {availableZones.map((zone) => <option key={zone.zone_id} value={zone.zone_id}>{zone.name || zone.local_ref}</option>)}
                            </select>
                            <IonButton size="small" fill="outline" disabled={group.zones.length >= 3 || !groupZoneSelections[groupKey]} onClick={() => {
                              const zone = row.availableZones.find((item) => item.zone_id === groupZoneSelections[groupKey]);
                              if (zone) updateProgramZoneDraft(row, zone, { enabled: true, durationSeconds: 600, runGroup: group.runGroup });
                              setGroupZoneSelections((prev) => ({ ...prev, [groupKey]: '' }));
                            }}>
                              Add zone
                            </IonButton>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="mt-3 text-sm text-muted">Add a watering group to begin building this program.</p>}
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
                  disabled={runBusy || !row.program.enabled || !orderedWateringGroups.length || controllerHasActiveProgram}
                  onClick={() => { void runProgramNow(row); }}
                >
                  {runBusy ? 'Starting...' : 'Run now'}
                </IonButton>
                {!controllerHasActiveProgram && !orderedWateringGroups.length ? <p className="self-center text-xs text-muted">Add a watering group before running this program.</p> : null}
                {controllerHasActiveProgram ? <p className="self-center text-xs text-muted">A controller run is active.</p> : null}
                {showStopControls ? (
                  <>
                    <IonButton
                      size="small"
                      color="danger"
                      disabled={stopBusy || skipBusy}
                      onClick={() => { void stopProgramRun(row, activeRun); }}
                    >
                      {stopBusy ? 'Stopping...' : 'Stop program'}
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
