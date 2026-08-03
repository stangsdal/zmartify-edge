import { useEffect, useState } from 'react';
import { commandsApi } from '../api/commands';
import {
  IrrigationSiteOverview,
  IrrigationZone,
  MobileEvent,
  mobileApi,
  subscribeRealtimeTopics,
} from '../api/mobile';

export type IrrigationZoneRunStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'rejected';

export interface IrrigationZoneRunState {
  deviceId: string;
  displayName: string;
  zone: IrrigationZone;
  zoneRef: string;
  status: IrrigationZoneRunStatus;
  commandId?: string;
  pendingAction?: 'start' | 'stop';
  pendingCommandId?: string;
  error?: string;
}

const zoneNumberFromRef = (ref: string): number | null => {
  const match = String(ref || '').match(/(?:zone|out|output|valve)[-_:]?(\d+)$/i);
  if (!match) return null;
  const zoneId = Number(match[1]);
  return Number.isInteger(zoneId) && zoneId > 0 ? zoneId : null;
};

const stateKey = (deviceId: string, zoneRef: string): string => `${deviceId}:${zoneRef}`;

const eventDeviceId = (topic: string, payload: Record<string, unknown>): string => {
  if (typeof payload.device_id === 'string') return payload.device_id;
  return topic.match(/^device:([^:]+):irrigation$/)?.[1] || '';
};

const eventCorrelationIds = (envelope: Record<string, unknown>, outcome: Record<string, unknown>): string[] => [
  envelope.command_id,
  envelope.run_id,
  outcome.command_id,
  outcome.run_id,
].filter((value): value is string => typeof value === 'string' && value.length > 0);

const outcomeStatus = (eventType: string, result: unknown): IrrigationZoneRunStatus | null => {
  if (eventType === 'run.started' || eventType === 'zone.started' || eventType === 'irrigation_zone_started') return 'running';
  if (eventType === 'run.stopped' || eventType === 'run.completed' || eventType === 'zone.stopped' || eventType === 'irrigation_zone_stopped') return 'idle';
  if (result === 'rejected' || eventType.endsWith('.rejected')) return 'rejected';
  return null;
};

const outcomeMatchesPendingAction = (
  status: IrrigationZoneRunStatus,
  pendingAction: 'start' | 'stop' | undefined,
): boolean => {
  if (!pendingAction) return false;
  return pendingAction === 'start'
    ? status === 'running' || status === 'rejected'
    : status === 'idle' || status === 'rejected';
};

const eventOutcome = (event: MobileEvent): Record<string, unknown> => {
  const envelope = event.payload || {};
  return envelope.payload && typeof envelope.payload === 'object'
    ? envelope.payload as Record<string, unknown>
    : envelope;
};

export function useIrrigationRunState(siteId: string) {
  const [overview, setOverview] = useState<IrrigationSiteOverview | null>(null);
  const [zoneRuns, setZoneRuns] = useState<IrrigationZoneRunState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      const snapshotRequest = mobileApi.getIrrigationZoneSnapshot(siteId);
      const overviewRequest = mobileApi.getIrrigationOverview(siteId);
      const snapshot = await snapshotRequest;
      const devices = snapshot.devices.map((device) => {
        const activeZoneIds = new Set(
          device.outputs
            .filter((output) => output.active && !output.is_master_valve)
            .map((output) => zoneNumberFromRef(output.local_ref || output.output_id))
            .filter((zoneId): zoneId is number => zoneId != null),
        );
        return (device.zones || []).map((zone) => {
          const zoneRef = zone.local_ref || zone.zone_id;
          return {
            deviceId: device.device_id,
            displayName: device.display_name,
            zone,
            zoneRef,
            status: activeZoneIds.has(zoneNumberFromRef(zoneRef) || 0) ? 'running' : 'idle',
          } satisfies IrrigationZoneRunState;
        });
      });
      setZoneRuns((previous) => devices.flat().map((next) => {
        const prior = previous.find((item) => stateKey(item.deviceId, item.zoneRef) === stateKey(next.deviceId, next.zoneRef));
        if (
          !prior
          || next.status === 'running'
          || prior.status === 'idle'
          || prior.status === 'rejected'
          || (prior.pendingAction === 'stop' && next.status === 'idle')
        ) return next;
        return prior;
      }));
      const nextOverview = await overviewRequest;
      setOverview(nextOverview);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!siteId) {
      setOverview(null);
      setZoneRuns([]);
      return undefined;
    }
    void refresh();
    const intervalId = window.setInterval(() => { void refresh(); }, 8000);
    return () => window.clearInterval(intervalId);
  }, [siteId]);

  useEffect(() => {
    if (!siteId) return undefined;
    let unsubscribe: () => void = () => undefined;
    let cancelled = false;
    void mobileApi.getSite(siteId).then((site) => {
      if (cancelled) return;
      unsubscribe = subscribeRealtimeTopics(
        site.devices.map((device) => `device:${device.device_id}:irrigation`),
        (event) => {
          const envelope = event.payload || {};
          const nestedPayload = envelope.payload;
          const outcome = nestedPayload && typeof nestedPayload === 'object'
            ? nestedPayload as Record<string, unknown>
            : envelope;
          const eventType = typeof outcome.event_type === 'string' ? outcome.event_type : event.event_type;
          const targetRef = typeof outcome.target_ref === 'string' ? outcome.target_ref : '';
          const zoneId = zoneNumberFromRef(targetRef) ?? Number(outcome.zone_id);
          const deviceId = eventDeviceId(event.topic, outcome);
          const correlationIds = eventCorrelationIds(envelope, outcome);
          const started = eventType === 'run.started' || eventType === 'zone.started' || eventType === 'irrigation_zone_started';
          const stopped = eventType === 'run.stopped' || eventType === 'run.completed' || eventType === 'zone.stopped' || eventType === 'irrigation_zone_stopped';
          const rejected = outcome.result === 'rejected' || eventType.endsWith('.rejected');
          if (!deviceId || (!started && !stopped && !rejected)) return;
          setZoneRuns((previous) => previous.map((zoneRun) => {
            const matchesZoneId = Number.isInteger(zoneId) && zoneId > 0 && zoneNumberFromRef(zoneRun.zoneRef) === zoneId;
            const matchesPendingCommand = zoneRun.pendingCommandId != null && correlationIds.includes(zoneRun.pendingCommandId);
            const status = started ? 'running' : rejected ? 'rejected' : 'idle';
            const pendingMatchesOutcome = matchesPendingCommand && outcomeMatchesPendingAction(status, zoneRun.pendingAction);
            if (zoneRun.deviceId !== deviceId) return zoneRun;
            if (zoneRun.pendingAction && !pendingMatchesOutcome) return zoneRun;
            if (!zoneRun.pendingAction && !matchesZoneId) return zoneRun;
            return {
              ...zoneRun,
              status,
              commandId: status === 'running' ? zoneRun.pendingCommandId : zoneRun.commandId,
              pendingAction: undefined,
              pendingCommandId: undefined,
              error: rejected ? 'The controller rejected this zone command.' : undefined,
            };
          }));
          void refresh();
        },
      );
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [siteId]);

  const startZone = async (deviceId: string, zoneRef: string, durationSeconds: number) => {
    const key = stateKey(deviceId, zoneRef);
    setZoneRuns((previous) => previous.map((zoneRun) =>
      stateKey(zoneRun.deviceId, zoneRun.zoneRef) === key
        ? { ...zoneRun, status: 'starting', pendingAction: 'start', pendingCommandId: undefined, error: undefined }
        : zoneRun,
    ));
    try {
      const result = await commandsApi.startIrrigationZone(deviceId, zoneRef, durationSeconds);
      setZoneRuns((previous) => previous.map((zoneRun) =>
        stateKey(zoneRun.deviceId, zoneRun.zoneRef) === key
          ? { ...zoneRun, pendingCommandId: result.command_id }
          : zoneRun,
      ));
      void reconcileCommandOutcome(deviceId, zoneRef, result.command_id);
      return result;
    } catch (reason) {
      setZoneRuns((previous) => previous.map((zoneRun) =>
        stateKey(zoneRun.deviceId, zoneRun.zoneRef) === key
          ? {
              ...zoneRun,
              status: 'rejected',
              pendingAction: undefined,
              pendingCommandId: undefined,
              error: reason instanceof Error ? reason.message : String(reason),
            }
          : zoneRun,
      ));
      throw reason;
    }
  };

  const stopZone = async (deviceId: string, zoneRef: string) => {
    const key = stateKey(deviceId, zoneRef);
    setZoneRuns((previous) => previous.map((zoneRun) =>
      stateKey(zoneRun.deviceId, zoneRun.zoneRef) === key
        ? { ...zoneRun, status: 'stopping', pendingAction: 'stop', pendingCommandId: undefined, error: undefined }
        : zoneRun,
    ));
    try {
      const result = await commandsApi.stopIrrigationZone(deviceId, zoneRef);
      setZoneRuns((previous) => previous.map((zoneRun) =>
        stateKey(zoneRun.deviceId, zoneRun.zoneRef) === key
          ? { ...zoneRun, pendingCommandId: result.command_id }
          : zoneRun,
      ));
      void reconcileCommandOutcome(deviceId, zoneRef, result.command_id);
      [750, 1500, 2250].forEach((delay) => {
        window.setTimeout(() => { void refresh(); }, delay);
      });
      return result;
    } catch (reason) {
      setZoneRuns((previous) => previous.map((zoneRun) =>
        stateKey(zoneRun.deviceId, zoneRun.zoneRef) === key
          ? { ...zoneRun, status: 'running', pendingAction: undefined, pendingCommandId: undefined, error: reason instanceof Error ? reason.message : String(reason) }
          : zoneRun,
      ));
      throw reason;
    }
  };

  const reconcileCommandOutcome = async (deviceId: string, zoneRef: string, commandId?: string, attempt = 0) => {
    if (!siteId || !commandId) return;
    try {
      const response = await mobileApi.listEvents(50, { siteId });
      const matchingEvent = (response.events || []).find((event) => {
        const outcome = eventOutcome(event);
        const eventType = typeof outcome.event_type === 'string' ? outcome.event_type : event.event_type;
        return (event.device_id === deviceId || outcome.device_id === deviceId)
          && eventCorrelationIds(event.payload || {}, outcome).includes(commandId)
          && outcomeStatus(eventType, outcome.result) != null;
      });
      if (!matchingEvent) {
        if (attempt < 3) {
          window.setTimeout(() => { void reconcileCommandOutcome(deviceId, zoneRef, commandId, attempt + 1); }, 750);
        }
        return;
      }
      const outcome = eventOutcome(matchingEvent);
      const eventType = typeof outcome.event_type === 'string' ? outcome.event_type : matchingEvent.event_type;
      const status = outcomeStatus(eventType, outcome.result);
      if (!status) return;
      setZoneRuns((previous) => previous.map((zoneRun) =>
        stateKey(zoneRun.deviceId, zoneRun.zoneRef) === stateKey(deviceId, zoneRef)
          && outcomeMatchesPendingAction(status, zoneRun.pendingAction)
          ? {
              ...zoneRun,
              status,
              commandId: status === 'running' ? commandId : zoneRun.commandId,
              pendingAction: undefined,
              pendingCommandId: undefined,
              error: status === 'rejected' ? 'The controller rejected this zone command.' : undefined,
            }
          : zoneRun,
      ));
    } catch {
      if (attempt < 3) {
        window.setTimeout(() => { void reconcileCommandOutcome(deviceId, zoneRef, commandId, attempt + 1); }, 750);
      }
    }
  };

  return { overview, zoneRuns, loading, error, refresh, startZone, stopZone };
}