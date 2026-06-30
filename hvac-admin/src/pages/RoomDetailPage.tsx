import { useEffect, useMemo, useRef, useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { useParams } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { ThermostatDial } from '../components/ThermostatDial';
import { apiClient } from '../api/client';
import { mobileApi, MobileSetpointResponse, MobileZone } from '../api/mobile';
import { freshnessFromAgeMs } from '../utils/freshness';

interface RouteParams {
  zoneRef: string;
}

export function RoomDetailPage() {
  const { zoneRef } = useParams<RouteParams>();
  const resolvedRef = decodeURIComponent(zoneRef);
  const [zone, setZone] = useState<MobileZone | null>(null);
  const [target, setTarget] = useState(21);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [setpointState, setSetpointState] = useState<'idle' | 'pending' | 'confirmed' | 'failed'>('idle');
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [streamState, setStreamState] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const lastAppliedRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  const applyIncomingZoneState = (nextZone: MobileZone) => {
    setZone(nextZone);
    setRenameValue(nextZone.name || '');
    const nextTarget = nextZone.target_temperature_c ?? 21;

    if (nextZone.setpoint_pending || nextZone.setpoint_command_state === 'pending_device_feedback') {
      setSetpointState('pending');
      setSaveError('');
    } else if ((nextZone.setpoint_command_state || '').startsWith('failed')) {
      setSetpointState('failed');
      if (nextZone.setpoint_failure_reason) {
        setSaveError(String(nextZone.setpoint_failure_reason));
      }
    } else if (nextZone.setpoint_command_state === 'confirmed') {
      setSetpointState('confirmed');
      setSaveError('');
    }

    if (!dirtyRef.current && !savingRef.current) {
      const pendingRequested =
        nextZone.setpoint_pending && typeof nextZone.setpoint_requested_target_c === 'number'
          ? nextZone.setpoint_requested_target_c
          : null;
      const dialTarget = pendingRequested ?? nextTarget;
      setTarget(dialTarget);
      lastAppliedRef.current = dialTarget;
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const sites = await mobileApi.listSites();
      for (const site of sites.sites || []) {
        const detail = await mobileApi.getSite(site.site_id);
        for (const device of detail.devices) {
          const dev = await mobileApi.getDevice(device.device_id);
          for (const z of dev.zones || []) {
            const zref = z.zone_uuid || `${device.device_id}:${z.zone_id}`;
            if (zref === resolvedRef) {
              if (cancelled) return;
              applyIncomingZoneState(z);
              return;
            }
          }
        }
      }
    };

    load().catch(console.error);
    const intervalId = window.setInterval(() => {
      load().catch(console.error);
    }, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [resolvedRef]);

  useEffect(() => {
    const token = apiClient.getAuthToken();
    if (!token) return;

    const rawBase = localStorage.getItem('api_base_url') || window.location.origin;
    const wsBase = rawBase.startsWith('https://')
      ? rawBase.replace('https://', 'wss://')
      : rawBase.replace('http://', 'ws://');

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    const connect = () => {
      const endpoint = `${wsBase}/mobile/ws/zones/${encodeURIComponent(resolvedRef)}?token=${encodeURIComponent(token)}`;
      socket = new WebSocket(endpoint);
      setStreamState('connecting');

      socket.onopen = () => {
        setStreamState('connected');
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type !== 'zone_update' || !payload.zone) return;
          applyIncomingZoneState(payload.zone as MobileZone);
        } catch {
          // Ignore malformed websocket messages.
        }
      };

      socket.onclose = () => {
        if (stopped) return;
        setStreamState('reconnecting');
        reconnectTimer = window.setTimeout(connect, 2000);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [resolvedRef]);

  const statusText = useMemo(() => {
    if (!zone) return 'Loading room status...';
    const freshness = freshnessFromAgeMs(zone.freshness_age_ms);
    if (freshness.state === 'offline' || !zone.online) return 'Offline';
    if (freshness.state === 'stale') return 'Stale data';
    const heating = zone.demand ?? zone.active ?? false;
    if (zone.fault) return `Fault: ${zone.fault}`;
    if (heating) return 'Heating';
    return 'Comfortable';
  }, [zone]);

  const heatSignalText = useMemo(() => {
    if (!zone) return 'Unknown';
    const freshness = freshnessFromAgeMs(zone.freshness_age_ms);
    if (freshness.state !== 'fresh') return freshness.label;
    if (zone.demand != null) return `Demand (${zone.demand ? 'ON' : 'OFF'})`;
    if (zone.active != null) return `Active fallback (${zone.active ? 'ON' : 'OFF'})`;
    return 'Unavailable';
  }, [zone]);

  useEffect(() => {
    if (!zone || !dirty) return;
    if (lastAppliedRef.current === target) {
      setDirty(false);
      return;
    }

    const timer = window.setTimeout(() => {
      const applyTarget = async () => {
        setSaving(true);
        setSaveError('');
        try {
          const result: MobileSetpointResponse = await mobileApi.setZoneSetpoint(resolvedRef, target);
          const pending = Boolean(result.pending || result.command_state === 'pending_device_feedback');
          lastAppliedRef.current = target;
          setZone((prev) =>
            prev
              ? {
                  ...prev,
                  target_temperature_c: pending ? prev.target_temperature_c : target,
                  setpoint_pending: pending,
                  setpoint_command_state: result.command_state,
                  setpoint_command_id: result.command_id ?? null,
                  setpoint_requested_target_c: target,
                  setpoint_failure_reason: pending ? null : prev.setpoint_failure_reason,
                }
              : prev,
          );
          setSetpointState(pending ? 'pending' : 'confirmed');
          setDirty(false);
        } catch (e) {
          setSetpointState('failed');
          setSaveError(String(e));
        } finally {
          setSaving(false);
        }
      };

      void applyTarget();
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [dirty, resolvedRef, target, zone]);

  const handleTargetChange = (nextTarget: number) => {
    setTarget(nextTarget);
    setDirty(true);
    setSaveError('');
    setSetpointState('idle');
  };

  const setpointStatusText = useMemo(() => {
    if (saving) return 'Sending setpoint...';
    if (dirty) return 'Will apply in a moment';
    if (setpointState === 'pending') return 'Waiting for device confirmation...';
    if (setpointState === 'failed') return 'Setpoint failed';
    if (setpointState === 'confirmed') return 'Setpoint confirmed';
    return 'Setpoint saved';
  }, [dirty, saving, setpointState]);

  const handleRename = async () => {
    const nextName = renameValue.trim();
    if (!nextName) {
      setRenameError('Room name cannot be empty.');
      return;
    }

    if (!resolvedRef) {
      setRenameError('Unable to resolve room identity for rename.');
      return;
    }

    setRenaming(true);
    setRenameError('');
    try {
      const renamed = await mobileApi.renameZoneByRef(resolvedRef, nextName);
      setZone((prev) => (prev ? { ...prev, name: renamed.name } : prev));
      setRenameValue(renamed.name);
    } catch (e) {
      setRenameError(String(e));
    } finally {
      setRenaming(false);
    }
  };

  return (
    <IonPage>
      <AppHeader title={zone?.name || 'Room'} subtitle="Thermostat Control" />
      <IonContent className="ion-padding">
        <div className="space-y-5 pb-8">
          <section className="rounded-3xl app-surface shadow-soft p-5">
            <div className="mb-3 flex justify-end">
              <span
                className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={{
                  color: streamState === 'connected' ? '#067647' : '#b54708',
                  backgroundColor: streamState === 'connected' ? 'rgba(18,183,106,0.15)' : 'rgba(247,144,9,0.16)',
                }}
              >
                {streamState === 'connected' ? 'Connected' : streamState === 'connecting' ? 'Connecting' : 'Reconnecting'}
              </span>
            </div>
            <ThermostatDial
              value={target}
              currentTemperature={zone?.current_temperature_c ?? null}
              humidity={zone?.humidity ?? null}
              freshnessAgeMs={zone?.freshness_age_ms ?? null}
              online={(zone?.online !== false) && freshnessFromAgeMs(zone?.freshness_age_ms).state === 'fresh'}
              fault={zone?.fault ?? null}
              windowOpen={zone?.window_open ?? null}
              roomName={zone?.name}
              statusLabel={statusText}
              heating={Boolean(zone?.demand ?? zone?.active)}
              thermostatMode={zone?.thermostat_mode ?? zone?.mode ?? null}
              onChange={handleTargetChange}
            />
            <p className="mt-3 text-center text-xs uppercase tracking-[0.22em] text-muted">
              {setpointStatusText}
            </p>
            {saveError && <p className="text-center text-sm mt-2 text-rose-600">{saveError}</p>}
          </section>

          <section className="rounded-2xl app-surface shadow-soft p-4 space-y-2">
            <p className="text-sm text-muted">Status</p>
            <p className="text-base font-medium">{statusText}</p>
            <p className="text-sm text-muted">Heat Signal</p>
            <p className="text-base">{heatSignalText}</p>
            <p className="text-sm text-muted">Last Update</p>
            <p className="text-base">{zone?.freshness_age_ms == null ? 'Unknown' : `${Math.floor(zone.freshness_age_ms / 1000)}s ago`}</p>
          </section>

          <section className="rounded-2xl app-surface shadow-soft p-4 space-y-3">
            <p className="text-sm text-muted">Room Name</p>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-xl border border-slate-300/70 bg-white/70 px-3 py-2 text-sm"
                value={renameValue}
                onChange={(event) => {
                  setRenameValue(event.target.value);
                  setRenameError('');
                }}
                placeholder="Enter room name"
                maxLength={64}
              />
              <button
                type="button"
                className="rounded-xl bg-brand-primary text-white px-4 py-2 text-sm font-medium disabled:opacity-60"
                onClick={() => {
                  void handleRename();
                }}
                disabled={renaming || !renameValue.trim() || renameValue.trim() === (zone?.name || '').trim()}
              >
                {renaming ? 'Saving...' : 'Save'}
              </button>
            </div>
            {renameError ? <p className="text-sm text-rose-600">{renameError}</p> : null}
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
